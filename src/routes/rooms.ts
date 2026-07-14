import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import prisma from '../db.js';

interface CreateRoomBody {
  is_group?: boolean;
  name?: string;
  userIds?: string[];
  email?: string | string[];
}

interface UpdateRoomBody {
  name?: string;
}

interface AddMembersBody {
  userIds?: string[];
}

interface RoomParams {
  id: string;
}

interface RoomMemberParams {
  id: string;
  userId: string;
}

// Reusable Prisma selector to avoid retrieving the BigInt primary key (room_members.id),
// which prevents Fastify JSON serialization errors.
const roomInclude = {
  room_members: {
    select: {
      joined_at: true,
      role: true,
      profiles: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar_url: true,
          contact_no: true,
          show_status: true,
          updated_at: true,
          user_status: {
            select: {
              is_online: true,
              last_seen: true,
            },
          },
        },
      },
    },
  },
  messages: {
    orderBy: {
      created_at: 'desc' as const,
    },
    take: 1,
    select: {
      text: true,
      file_url: true,
    },
  },
};

const roomsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Enforce JWT Authentication for all room endpoints
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Session has expired or is invalid. Please log in again.',
      });
    }
  });

  // 1. Create Room (Direct Message or Group Room)
  // POST /api/rooms
  fastify.post<{ Body: CreateRoomBody }>('/', async (request, reply) => {
    const currentUserId = request.user.id;
    const { is_group = false, name, userIds = [], email } = request.body || {};

    let members = Array.isArray(userIds)
      ? userIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    members = Array.from(new Set(members));

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!is_group) {
      // Direct Message (one-on-one) Room
      if (!email || typeof email !== 'string' || email.trim() === '') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Recipient email address is required to create a direct message room.',
        });
      }

      const targetEmail = email.trim().toLowerCase();

      // 1. Verify user is not trying to DM themselves
      if (request.user.email && targetEmail === request.user.email.toLowerCase()) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'You cannot start a direct message room with yourself.',
        });
      }

      // 2. Look up the profile by email
      const otherUserProfile = await prisma.profiles.findUnique({
        where: { email: targetEmail },
      });

      if (!otherUserProfile) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'No user profile found with the specified email address.',
        });
      }

      const otherUserId = otherUserProfile.id;

      // 3. Fetch current user's profile to get their name
      const currentUserProfile = await prisma.profiles.findUnique({
        where: { id: currentUserId },
      });

      if (!currentUserProfile) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Your user profile does not exist.',
        });
      }

      // Check if a DM room already exists between these two users (even if one has left)
      const existingRoom = await prisma.rooms.findFirst({
        where: {
          is_group: false,
          room_members: {
            some: {
              user_id: {
                in: [currentUserId, otherUserId],
              },
            },
          },
          name: {
            in: [currentUserProfile.name, otherUserProfile.name],
          },
        },
        include: roomInclude,
      });

      if (existingRoom) {
        // Re-add current user if they left
        const isCurrentUserMember = existingRoom.room_members.some(
          (m) => m.profiles.id === currentUserId
        );
        if (!isCurrentUserMember) {
          await prisma.room_members.create({
            data: {
              room_id: existingRoom.id,
              user_id: currentUserId,
            },
          });
        }

        // Re-add other user if they left
        const isOtherUserMember = existingRoom.room_members.some(
          (m) => m.profiles.id === otherUserId
        );
        if (!isOtherUserMember) {
          await prisma.room_members.create({
            data: {
              room_id: existingRoom.id,
              user_id: otherUserId,
            },
          });
        }

        // Fetch updated room details
        const updatedRoom = await prisma.rooms.findUnique({
          where: { id: existingRoom.id },
          include: roomInclude,
        });

        return reply.status(200).send({
          message: 'Direct message room already exists.',
          room: updatedRoom,
        });
      }

      // Determine DM room name: use custom name if provided, otherwise default to recipient's profile name
      const roomName = (name && typeof name === 'string' && name.trim() !== '')
        ? name.trim()
        : (otherUserProfile ? otherUserProfile.name : null);

      try {
        // Create new DM room in a transaction
        const newRoom = await prisma.$transaction(async (tx) => {
          const room = await tx.rooms.create({
            data: {
              is_group: false,
              name: roomName,
            },
          });

          await tx.room_members.createMany({
            data: [
              { room_id: room.id, user_id: currentUserId },
              { room_id: room.id, user_id: otherUserId },
            ],
          });

          return room;
        });

        // Retrieve created room with member details
        const fullRoom = await prisma.rooms.findUnique({
          where: { id: newRoom.id },
          include: roomInclude,
        });

        return reply.status(201).send({
          message: 'Direct message room created successfully.',
          room: fullRoom,
        });
      } catch (err) {
        request.log.error(err, 'Error creating direct message room');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create direct message room.',
        });
      }
    } else {
      // Group Room
      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Group room name is required and cannot be empty.',
        });
      }
      if (trimmedName.length > 100) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Group room name cannot exceed 100 characters.',
        });
      }

      // 1. Extract email list from body
      let emails: string[] = [];
      if (Array.isArray(email)) {
        emails = email.filter((e): e is string => typeof e === 'string' && e.trim() !== '');
      } else if (typeof email === 'string' && email.trim() !== '') {
        emails = [email];
      }

      if (emails.length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'At least one member email address is required to create a group room.',
        });
      }

      const cleanEmails = Array.from(new Set(emails.map(e => e.trim().toLowerCase())));

      // 2. Lookup profiles by email
      const memberProfiles = await prisma.profiles.findMany({
        where: {
          email: { in: cleanEmails },
        },
      });

      // 3. Verify all emails exist
      const foundEmails = memberProfiles.map(p => p.email.toLowerCase());
      const missingEmails = cleanEmails.filter(e => !foundEmails.includes(e));

      if (missingEmails.length > 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `No user profiles found for the following email addresses: ${missingEmails.join(', ')}`,
        });
      }

      // Filter out creator's profile if it was explicitly added in the email list
      const otherMemberProfiles = memberProfiles.filter(p => p.id !== currentUserId);
      const otherMemberIds = otherMemberProfiles.map(p => p.id);

      const allGroupMemberIds = Array.from(new Set([currentUserId, ...otherMemberIds]));

      try {
        // Create new Group room in a transaction
        const newRoom = await prisma.$transaction(async (tx) => {
          const room = await tx.rooms.create({
            data: {
              is_group: true,
              name: trimmedName,
            },
          });

          await tx.room_members.createMany({
            data: allGroupMemberIds.map(id => ({
              room_id: room.id,
              user_id: id,
              role: id === currentUserId ? 'owner' : 'member',
            })),
          });

          return room;
        });

        // Retrieve created room with member details
        const fullRoom = await prisma.rooms.findUnique({
          where: { id: newRoom.id },
          include: roomInclude,
        });

        return reply.status(201).send({
          message: 'Group room created successfully.',
          room: fullRoom,
        });
      } catch (err) {
        request.log.error(err, 'Error creating group room');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create group room.',
        });
      }
    }
  });

  // 2. List User's Rooms
  // GET /api/rooms
  fastify.get('/', async (request, reply) => {
    const currentUserId = request.user.id;

    try {
      const rooms = await prisma.rooms.findMany({
        where: {
          room_members: {
            some: {
              user_id: currentUserId,
            },
          },
        },
        include: roomInclude,
        orderBy: {
          created_at: 'desc',
        },
      });

      return reply.status(200).send({ rooms });
    } catch (err) {
      request.log.error(err, 'Error listing rooms');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve rooms.',
      });
    }
  });

  // 3. Get Specific Room Details
  // GET /api/rooms/:id
  fastify.get<{ Params: RoomParams }>('/:id', async (request, reply) => {
    const currentUserId = request.user.id;
    const { id } = request.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id },
        include: roomInclude,
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const isMember = room.room_members.some(member => member.profiles.id === currentUserId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      return reply.status(200).send({ room });
    } catch (err) {
      request.log.error(err, 'Error retrieving room details');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve room details.',
      });
    }
  });

  // 4. Update Room (e.g., rename group room)
  // PATCH /api/rooms/:id
  fastify.patch<{ Params: RoomParams; Body: UpdateRoomBody }>('/:id', async (request, reply) => {
    const currentUserId = request.user.id;
    const { id } = request.params;
    const { name } = request.body || {};

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id },
        include: roomInclude,
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const currentUserMember = room.room_members.find(member => member.profiles.id === currentUserId);
      if (!currentUserMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      if (!room.is_group) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot update the name of a direct message room.',
        });
      }

      if (currentUserMember.role !== 'owner' && currentUserMember.role !== 'admin') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Only the room owner or admins can update the group room name.',
        });
      }

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Room name cannot be empty.',
        });
      }
      if (trimmedName.length > 100) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Room name cannot exceed 100 characters.',
        });
      }

      const updatedRoom = await prisma.rooms.update({
        where: { id },
        data: { name: trimmedName },
        include: roomInclude,
      });

      return reply.status(200).send({
        message: 'Room name updated successfully.',
        room: updatedRoom,
      });
    } catch (err) {
      request.log.error(err, 'Error updating room');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update room details.',
      });
    }
  });

  // 5. Delete Room
  // DELETE /api/rooms/:id
  fastify.delete<{ Params: RoomParams }>('/:id', async (request, reply) => {
    const currentUserId = request.user.id;
    const { id } = request.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id },
        include: roomInclude,
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const currentUserMember = room.room_members.find(member => member.profiles.id === currentUserId);
      if (!currentUserMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      if (!room.is_group) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Only group rooms can be deleted.',
        });
      }

      if (currentUserMember.role !== 'owner') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Only the room owner can delete the group room.',
        });
      }

      // Deleting the room cascades to room_members and messages automatically
      await prisma.rooms.delete({
        where: { id },
      });

      return reply.status(200).send({
        message: 'Room deleted successfully.',
      });
    } catch (err) {
      request.log.error(err, 'Error deleting room');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete room.',
      });
    }
  });

  // 6. Add Members to Group Room
  // POST /api/rooms/:id/members
  fastify.post<{ Params: RoomParams; Body: AddMembersBody }>('/:id/members', async (request, reply) => {
    const currentUserId = request.user.id;
    const { id } = request.params;
    const { userIds = [] } = request.body || {};

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id },
        include: roomInclude,
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const currentUserMember = room.room_members.find(member => member.profiles.id === currentUserId);
      if (!currentUserMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      if (!room.is_group) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot add members to a direct message room.',
        });
      }

      if (currentUserMember.role !== 'owner' && currentUserMember.role !== 'admin') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Only the room owner or admins can add members to the group room.',
        });
      }

      let membersToAdd = Array.isArray(userIds)
        ? userIds.filter((uid): uid is string => typeof uid === 'string' && uid.trim() !== '')
        : [];
      membersToAdd = Array.from(new Set(membersToAdd));

      if (membersToAdd.length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'At least one valid user ID must be provided.',
        });
      }

      for (const uid of membersToAdd) {
        if (!uuidRegex.test(uid)) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: `Invalid user ID format: ${uid}`,
          });
        }
      }

      // Check if all user profiles exist
      const existingProfilesCount = await prisma.profiles.count({
        where: { id: { in: membersToAdd } },
      });
      if (existingProfilesCount !== membersToAdd.length) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'One or more of the specified user profiles do not exist.',
        });
      }

      // Filter out users who are already members
      const existingMemberIds = room.room_members.map(m => m.profiles.id);
      const newMembersToAdd = membersToAdd.filter(uid => !existingMemberIds.includes(uid));

      if (newMembersToAdd.length === 0) {
        return reply.status(400).send({
          error: 'Conflict',
          message: 'All specified users are already members of this room.',
        });
      }

      await prisma.room_members.createMany({
        data: newMembersToAdd.map(uid => ({
          room_id: id,
          user_id: uid,
        })),
      });

      const updatedRoom = await prisma.rooms.findUnique({
        where: { id },
        include: roomInclude,
      });

      return reply.status(200).send({
        message: 'Members added successfully.',
        room: updatedRoom,
      });
    } catch (err) {
      request.log.error(err, 'Error adding members to room');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to add members to room.',
      });
    }
  });

  // 7. Remove Member / Leave Group Room
  // DELETE /api/rooms/:id/members/:userId
  fastify.delete<{ Params: RoomMemberParams }>('/:id/members/:userId', async (request, reply) => {
    const currentUserId = request.user.id;
    const { id, userId } = request.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id) || !uuidRegex.test(userId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID or user ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id },
        include: roomInclude,
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const currentUserMember = room.room_members.find(member => member.profiles.id === currentUserId);
      if (!currentUserMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      if (!room.is_group) {
        // For DM rooms, we ONLY allow leaving (userId === currentUserId)
        if (userId !== currentUserId) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Cannot remove other members from a direct message room.',
          });
        }
      }

      const targetMember = room.room_members.find(m => m.profiles.id === userId);
      if (!targetMember) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'The specified user is not a member of this room.',
        });
      }

      if (room.is_group) {
        if (userId !== currentUserId) {
          // Kick permission checks
          if (currentUserMember.role !== 'owner' && currentUserMember.role !== 'admin') {
            return reply.status(403).send({
              error: 'Forbidden',
              message: 'Only the room owner or admins can remove members from the group room.',
            });
          }

          if (currentUserMember.role === 'admin' && (targetMember.role === 'owner' || targetMember.role === 'admin')) {
            return reply.status(403).send({
              error: 'Forbidden',
              message: 'Admins cannot remove other admins or the room owner.',
            });
          }
        }
      }

      const otherMembers = room.room_members.filter(m => m.profiles.id !== userId);

      await prisma.$transaction(async (tx) => {
        if (room.is_group && targetMember.role === 'owner' && otherMembers.length > 0) {
          const sortedOthers = [...otherMembers].sort((a, b) => {
            const timeA = a.joined_at ? new Date(a.joined_at).getTime() : 0;
            const timeB = b.joined_at ? new Date(b.joined_at).getTime() : 0;
            return timeA - timeB;
          });
          let newOwnerCandidate = sortedOthers.find(m => m.role === 'admin');
          if (!newOwnerCandidate) {
            newOwnerCandidate = sortedOthers[0];
          }
          if (newOwnerCandidate) {
            await tx.room_members.update({
              where: {
                room_id_user_id: {
                  room_id: id,
                  user_id: newOwnerCandidate.profiles.id,
                },
              },
              data: {
                role: 'owner',
              },
            });
          }
        }

        await tx.room_members.delete({
          where: {
            room_id_user_id: {
              room_id: id,
              user_id: userId,
            },
          },
        });
      });

      // Check if room still exists (since a DB trigger might have auto-deleted it)
      const roomExists = await prisma.rooms.findUnique({
        where: { id },
      });

      if (!roomExists) {
        return reply.status(200).send({
          message: 'Left the room. Since there were no remaining members, the room has been deleted.',
        });
      }

      const remainingCount = room.room_members.length - 1;
      if (remainingCount === 0) {
        try {
          await prisma.rooms.delete({
            where: { id },
          });
        } catch (err) {
          // Ignore if already deleted by concurrent process/trigger
        }
        return reply.status(200).send({
          message: 'Left the room. Since there were no remaining members, the room has been deleted.',
        });
      }

      return reply.status(200).send({
        message: currentUserId === userId ? 'You have successfully left the room.' : 'Member removed successfully.',
      });
    } catch (err) {
      request.log.error(err, 'Error removing member from room');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to remove member from room.',
      });
    }
  });
};

export default roomsRoutes;
