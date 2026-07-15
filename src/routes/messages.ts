import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import prisma from '../db.js';
import { uploadBase64Attachment, deleteStorageFile } from '../utils/storage.js';

interface SendMessageBody {
  text?: string;
  file_url?: string;
}

interface SocketWithUser {
  userId?: string;
  roomIds?: Set<string>;
  send: (payload: string) => void;
  close: () => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
}

const serializeMessage = (message: any) => ({
  id: message.id?.toString?.() || String(message.id),
  roomId: message.room_id,
  senderId: message.sender_id,
  text: message.text,
  fileUrl: message.file_url,
  status: message.status,
  createdAt: message.created_at,
  sender: message.profiles
    ? {
      id: message.profiles.id,
      name: message.profiles.name,
      avatarUrl: message.profiles.avatar_url,
    }
    : null,
});

export const roomSockets = new Map<string, Set<SocketWithUser>>();
export const userSockets = new Map<string, Set<SocketWithUser>>();

export const broadcastShowStatusUpdate = async (userId: string, showStatus: boolean) => {
  const settingData = JSON.stringify({
    event: 'user:status-setting:update',
    payload: { userId, showStatus },
  });

  const isOnline = userSockets.has(userId) && userSockets.get(userId)!.size > 0;

  const presenceData = JSON.stringify({
    event: 'presence:update',
    payload: { userId, isOnline: showStatus ? isOnline : false },
  });

  for (const sockets of roomSockets.values()) {
    for (const socket of sockets) {
      try {
        socket.send(settingData);
        socket.send(presenceData);
      } catch (err) {
        // Ignore send errors for disconnected/stale sockets
      }
    }
  }
};

const messageRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  const addSocketToRoom = (roomId: string, socket: SocketWithUser) => {
    const roomSet = roomSockets.get(roomId) || new Set<SocketWithUser>();
    roomSet.add(socket);
    roomSockets.set(roomId, roomSet);
    socket.roomIds = socket.roomIds || new Set<string>();
    socket.roomIds.add(roomId);
    fastify.log.info(`[WS] User ${socket.userId} joined room ${roomId}. Active sockets in room: ${roomSet.size}`);
  };

  const removeSocketFromRoom = (socket: SocketWithUser) => {
    if (!socket.roomIds) return;
    for (const roomId of socket.roomIds) {
      const set = roomSockets.get(roomId);
      if (set) {
        set.delete(socket);
        fastify.log.info(`[WS] User ${socket.userId} left room ${roomId}. Remaining active sockets: ${set.size}`);
        if (set.size === 0) {
          roomSockets.delete(roomId);
        }
      }
    }
    socket.roomIds.clear();
  };

  const emitToRoom = (roomId: string, event: string, payload: unknown) => {
    const sockets = roomSockets.get(roomId);
    fastify.log.info(`[WS] emitToRoom called for room ${roomId}, event ${event}. Active socket count: ${sockets?.size || 0}`);
    if (!sockets) return;
    const data = JSON.stringify({ event, payload });
    for (const socket of sockets) {
      socket.send(data);
    }
  };

  const emitPresenceUpdate = async (userId: string, isOnline: boolean) => {
    // Check if user has enabled show_status
    try {
      const userProfile = await prisma.profiles.findUnique({
        where: { id: userId },
        select: { show_status: true },
      });

      // Only emit presence if user has enabled show_status
      if (!userProfile?.show_status) {
        return;
      }
    } catch (error) {
      fastify.log.error({ error }, `Failed to check show_status for user ${userId}`);
      return;
    }

    const data = JSON.stringify({
      event: 'presence:update',
      payload: { userId, isOnline },
    });

    for (const sockets of roomSockets.values()) {
      for (const socket of sockets) {
        socket.send(data);
      }
    }
  };

  const setUserOnlineStatus = async (userId: string, isOnline: boolean) => {
    try {
      await prisma.user_status.upsert({
        where: { id: userId },
        create: {
          id: userId,
          is_online: isOnline,
          last_seen: new Date(),
        },
        update: {
          is_online: isOnline,
          last_seen: new Date(),
        },
      });
    } catch (error) {
      // Ignore presence persistence failures so the chat still works.
    }
  };

  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/ws')) return;
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Session has expired or is invalid. Please log in again.',
      });
    }
  });
  
  fastify.get('/api/media', async (request, reply) => {
    const currentUserId = request.user.id;
    try {
      const userRooms = await prisma.room_members.findMany({
        where: { user_id: currentUserId },
        select: { room_id: true }
      });
      const roomIds = userRooms.map((rm) => rm.room_id);

      const messages = await prisma.messages.findMany({
        where: {
          room_id: { in: roomIds },
          file_url: { not: null },
          status: { not: 'deleted' }
        },
        include: {
          profiles: {
            select: {
              id: true,
              name: true,
              avatar_url: true,
            }
          },
          rooms: {
            select: {
              id: true,
              is_group: true,
              name: true,
              room_members: {
                select: {
                  profiles: {
                    select: {
                      id: true,
                      name: true,
                      avatar_url: true,
                    }
                  }
                }
              }
            }
          }
        },
        orderBy: { created_at: 'desc' }
      });

      const mediaItems = messages.map((msg) => {
        let roomName = msg.rooms.name || 'Direct Message';
        if (!msg.rooms.is_group) {
          const otherMember = msg.rooms.room_members.find(
            (m) => m.profiles.id !== currentUserId
          );
          if (otherMember) {
            roomName = otherMember.profiles.name;
          }
        }

        const urlParts = msg.file_url!.split('/');
        const filename = decodeURIComponent(urlParts[urlParts.length - 1]);
        const cleanName = filename
          .replace(/^[a-f0-9-]{36}_\d+_/, "")
          .replace(/^\w+_\d+_/, "");

        let fileType = 'document';
        if (/\.(jpg|jpeg|png|gif|webp|svg)/i.test(msg.file_url!)) {
          fileType = 'image';
        } else if (/\.(mp4|webm|ogg|mov)/i.test(msg.file_url!)) {
          fileType = 'video';
        }

        return {
          id: msg.id.toString(),
          roomId: msg.room_id,
          roomName,
          senderId: msg.sender_id,
          senderName: msg.profiles?.name || 'Unknown',
          senderAvatar: msg.profiles?.avatar_url,
          url: msg.file_url,
          name: cleanName || 'Attachment',
          type: fileType,
          createdAt: msg.created_at,
        };
      });

      return reply.status(200).send({ media: mediaItems });
    } catch (error) {
      request.log.error(error, 'Error fetching shared media');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve shared media.',
      });
    }
  });

  fastify.get('/api/messages/:roomId', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const { limit, before } = request.query as { limit?: string; before?: string };
    const currentUserId = request.user.id;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(roomId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
          room_members: {
            select: { user_id: true },
          },
        },
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const isMember = room.room_members.some((member) => member.user_id === currentUserId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      const parsedLimit = parseInt(limit || '30', 10);
      const messageLimit = isNaN(parsedLimit) || parsedLimit <= 0 ? 30 : parsedLimit;

      const whereClause: any = { room_id: roomId };
      if (before) {
        const beforeDate = new Date(before);
        if (!isNaN(beforeDate.getTime())) {
          whereClause.created_at = { lt: beforeDate };
        }
      }

      const messages = await prisma.messages.findMany({
        where: whereClause,
        include: {
          profiles: {
            select: {
              id: true,
              name: true,
              avatar_url: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: messageLimit + 1,
      });

      const hasMore = messages.length > messageLimit;
      const slicedMessages = hasMore ? messages.slice(0, messageLimit) : messages;

      // Reverse messages back to chronological order (asc)
      slicedMessages.reverse();

      await prisma.messages.updateMany({
        where: {
          room_id: roomId,
          sender_id: { not: currentUserId },
          status: { not: 'read' },
        },
        data: { status: 'read' },
      });

      return reply.status(200).send({
        messages: slicedMessages.map((message) => serializeMessage(message)),
        hasMore,
      });
    } catch (error) {
      request.log.error(error, 'Error fetching room messages');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve messages.',
      });
    }
  });

  fastify.post('/api/messages/:roomId', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const currentUserId = request.user.id;
    const { text, file_url } = request.body as SendMessageBody;

    const normalizedText = typeof text === 'string' ? text.trim() : '';
    const normalizedFileUrl = typeof file_url === 'string' && file_url.trim() ? file_url.trim() : null;

    if (!normalizedText && !normalizedFileUrl) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Message text or file is required.',
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(roomId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
          room_members: {
            select: { user_id: true },
          },
        },
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const isMember = room.room_members.some((member) => member.user_id === currentUserId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      const createdMessage = await prisma.messages.create({
        data: {
          room_id: roomId,
          sender_id: currentUserId,
          text: normalizedText || null,
          file_url: normalizedFileUrl,
          status: 'sent',
        },
        include: {
          profiles: {
            select: {
              id: true,
              name: true,
              avatar_url: true,
            },
          },
        },
      });

      const payload = serializeMessage(createdMessage);
      emitToRoom(roomId, 'message:new', payload);

      return reply.status(201).send({
        message: payload,
      });
    } catch (error) {
      request.log.error(error, 'Error sending message');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to send message.',
      });
    }
  });

  fastify.post('/api/messages/:roomId/upload', async (request, reply) => {
    const { roomId } = request.params as { roomId: string };
    const currentUserId = request.user.id;
    const { file_data_url, original_name } = request.body as { file_data_url: string; original_name?: string };

    if (!file_data_url) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'file_data_url is required.',
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(roomId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
          room_members: {
            select: { user_id: true },
          },
        },
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const isMember = room.room_members.some((member) => member.user_id === currentUserId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      const uploadResult = await uploadBase64Attachment(file_data_url, roomId, currentUserId, original_name);
      if (uploadResult.error) {
        request.log.error({ error: uploadResult.error }, 'Attachment upload failed');
        return reply.status(400).send({
          error: 'Bad Request',
          message: uploadResult.error,
        });
      }

      return reply.status(200).send({
        file_url: uploadResult.publicUrl,
      });
    } catch (error) {
      request.log.error(error, 'Error uploading attachment');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to upload attachment.',
      });
    }
  });

  // DELETE /api/messages/:messageId
  fastify.delete<{ Params: { messageId: string } }>('/api/messages/:messageId', async (request, reply) => {
    const currentUserId = request.user.id;
    const { messageId } = request.params;

    let messageIdBigInt: bigint;
    try {
      messageIdBigInt = BigInt(messageId);
    } catch {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid message ID format.',
      });
    }

    try {
      const message = await prisma.messages.findUnique({
        where: { id: messageIdBigInt },
      });

      if (!message) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Message not found.',
        });
      }

      const roomMember = await prisma.room_members.findFirst({
        where: {
          room_id: message.room_id,
          user_id: currentUserId,
        },
      });

      if (!roomMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not authorized to delete this message.',
        });
      }

      // Delete from storage bucket if there is an attachment
      if (message.file_url) {
        try {
          await deleteStorageFile(message.file_url);
        } catch (storageErr) {
          request.log.error(storageErr, `Failed to delete file from storage: ${message.file_url}`);
        }
      }

      // Soft delete: clear content & set status to deleted
      await prisma.messages.update({
        where: { id: messageIdBigInt },
        data: {
          status: 'deleted',
          text: null,
          file_url: null,
        },
      });

      // Broadcast deletion event to the room
      emitToRoom(message.room_id, 'message:delete', {
        messageId: messageId,
        roomId: message.room_id,
      });

      return reply.status(200).send({
        message: 'Message deleted successfully.',
      });
    } catch (err) {
      request.log.error(err, 'Error deleting message');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete message.',
      });
    }
  });

  // DELETE /api/messages/room/:roomId/clear
  fastify.delete<{ Params: { roomId: string } }>('/api/messages/room/:roomId/clear', async (request, reply) => {
    const currentUserId = request.user.id;
    const { roomId } = request.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(roomId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid room ID format.',
      });
    }

    try {
      const room = await prisma.rooms.findUnique({
        where: { id: roomId },
        include: {
          room_members: {
            select: { user_id: true },
          },
        },
      });

      if (!room) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Room not found.',
        });
      }

      const isMember = room.room_members.some((member) => member.user_id === currentUserId);
      if (!isMember) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You are not a member of this room.',
        });
      }

      const userProfile = await prisma.profiles.findUnique({
        where: { id: currentUserId },
        select: { name: true },
      });
      const username = userProfile?.name || 'User';

      // 1. Fetch messages with file attachments in the room
      const messagesWithFiles = await prisma.messages.findMany({
        where: {
          room_id: roomId,
          file_url: { not: null },
        },
        select: { file_url: true },
      });

      // 2. Delete files from storage bucket
      for (const msg of messagesWithFiles) {
        if (msg.file_url) {
          try {
            await deleteStorageFile(msg.file_url);
          } catch (storageErr) {
            request.log.error(storageErr, `Failed to delete file from storage: ${msg.file_url}`);
          }
        }
      }

      // 3. Delete all messages in the room from the database
      await prisma.messages.deleteMany({
        where: { room_id: roomId },
      });

      // Create a system message
      const systemMessage = await prisma.messages.create({
        data: {
          room_id: roomId,
          sender_id: null,
          text: `Chat history cleared by ${username}`,
          status: 'sent',
        },
        include: {
          profiles: {
            select: {
              id: true,
              name: true,
              avatar_url: true,
            },
          },
        },
      });

      const payload = serializeMessage(systemMessage);

      // Emit clear event to WebSocket room
      emitToRoom(roomId, 'message:clear', {
        roomId,
        systemMessage: payload,
      });

      return reply.status(200).send({
        message: 'Chat cleared successfully.',
        systemMessage: payload,
      });
    } catch (error) {
      request.log.error(error, 'Error clearing chat');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to clear chat history.',
      });
    }
  });

  fastify.get('/ws', { websocket: true }, async (connection, request) => {
    const socket = connection.socket as SocketWithUser;

    try {
      await request.jwtVerify();
    } catch (err: any) {
      fastify.log.error(err, 'WS Connection jwtVerify failed');
      socket.close();
      return;
    }

    if (!request.user?.id) {
      socket.close();
      return;
    }

    const currentUserId = request.user.id;

    socket.userId = currentUserId;
    socket.roomIds = new Set<string>();

    const userRooms = await prisma.room_members.findMany({
      where: { user_id: currentUserId },
      select: { room_id: true },
    });

    for (const room of userRooms) {
      addSocketToRoom(room.room_id, socket);
    }

    const userSet = userSockets.get(currentUserId) || new Set<SocketWithUser>();
    userSet.add(socket);
    userSockets.set(currentUserId, userSet);

    await setUserOnlineStatus(currentUserId, true);
    await emitPresenceUpdate(currentUserId, true);

    socket.on('message', async (rawMessage) => {
      try {
        const text = typeof rawMessage === 'string' ? rawMessage : rawMessage.toString();
        const parsed = JSON.parse(text);

        if (parsed?.event === 'typing') {
          emitToRoom(parsed.roomId, 'typing:update', {
            roomId: parsed.roomId,
            userId: currentUserId,
            userName: parsed.userName || request.user.email,
            isTyping: true,
          });
          return;
        }

        if (parsed?.event === 'typing-stop') {
          emitToRoom(parsed.roomId, 'typing:update', {
            roomId: parsed.roomId,
            userId: currentUserId,
            userName: parsed.userName || request.user.email,
            isTyping: false,
          });
          return;
        }

        if (parsed?.event === 'message:read') {
          const roomId = parsed.roomId;
          const messageIds = Array.isArray(parsed.messageIds) ? parsed.messageIds : [];
          if (roomId && messageIds.length > 0) {
            await prisma.messages.updateMany({
              where: {
                id: { in: messageIds.map((id: string) => BigInt(id)) },
                sender_id: { not: currentUserId },
                room_id: roomId,
              },
              data: { status: 'read' },
            });
            emitToRoom(roomId, 'message:read', {
              roomId,
              userId: currentUserId,
              messageIds,
            });
          }
        }
      } catch {
        // Ignore malformed websocket payloads.
      }
    });

    socket.on('close', async () => {
      removeSocketFromRoom(socket);
      const userSetAfter = userSockets.get(currentUserId);
      if (userSetAfter) {
        userSetAfter.delete(socket);
        if (userSetAfter.size === 0) {
          userSockets.delete(currentUserId);
          await setUserOnlineStatus(currentUserId, false);
          await emitPresenceUpdate(currentUserId, false);
        }
      }
    });
  });
};

export default messageRoutes;
