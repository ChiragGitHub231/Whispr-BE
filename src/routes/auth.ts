import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcrypt';
import prisma from '../db.js';
import { uploadBase64Image, deleteStorageFile } from '../utils/storage.js';
import { broadcastShowStatusUpdate } from './messages.js';

// Extend Fastify JWT types
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: string; email: string };
    user: { id: string; email: string };
  }
}

interface RegisterBody {
  email?: string;
  password?: string;
  name?: string;
  contact_no?: string;
  avatar_url?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // Register Route
  fastify.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    const { email: rawEmail, password: rawPassword, name: rawName, contact_no, avatar_url } = request.body || {};

    const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
    const password = typeof rawPassword === 'string' ? rawPassword.trim() : '';
    const name = typeof rawName === 'string' ? rawName.trim() : '';

    // 1. Validate Name
    if (!name) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Name is a required field and cannot be empty.',
      });
    }
    if (name.length < 2) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Name must be at least 2 characters long.',
      });
    }

    // 2. Validate Email
    if (!email) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Email is a required field and cannot be empty.',
      });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Please provide a valid email address.',
      });
    }

    // 3. Validate Password
    if (!password) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Password is a required field and cannot be empty.',
      });
    }
    if (password.length < 6) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Password must be at least 6 characters long.',
      });
    }

    // 4. Validate Contact Number (Optional)
    let contactVal: string | null = null;
    if (contact_no && typeof contact_no === 'string' && contact_no.trim()) {
      contactVal = contact_no.trim();
      const phoneRegex = /^\+?[0-9\s\-]{7,15}$/;
      if (!phoneRegex.test(contactVal)) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Please provide a valid contact number (7 to 15 digits).',
        });
      }
    }

    // 5. Validate Avatar URL (Optional)
    let avatarVal: string | null = null;
    if (avatar_url && typeof avatar_url === 'string' && avatar_url.trim()) {
      avatarVal = avatar_url.trim();
      try {
        new URL(avatarVal);
      } catch (_) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Please provide a valid URL for the avatar.',
        });
      }
    }

    const trimmedEmail = email.toLowerCase();

    try {
      // 1. Check if user already exists in profiles
      const existingUser = await prisma.profiles.findUnique({
        where: { email: trimmedEmail },
      });

      if (existingUser) {
        return reply.status(400).send({
          error: 'Conflict',
          message: 'A user with this email address already exists.',
        });
      }

      // 2. Hash the password
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // 3. Run registration steps inside a Prisma transaction
      const newProfile = await prisma.$transaction(async (tx) => {
        const profile = await tx.profiles.create({
          data: {
            name,
            email: trimmedEmail,
            password: passwordHash,
            contact_no: contactVal,
            avatar_url: avatarVal,
          },
        });

        await tx.user_status.create({
          data: {
            id: profile.id,
            is_online: false,
          },
        });


        return profile;
      });

      // 4. Sign JWT
      const token = fastify.jwt.sign({ id: newProfile.id, email: newProfile.email });

      // 5. Set HTTP-only Cookie
      reply.setCookie('token', token, {
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      // 6. Return response
      return reply.status(201).send({
        message: 'Registration successful',
        user: {
          id: newProfile.id,
          name: newProfile.name,
          email: newProfile.email,
          contact_no: newProfile.contact_no,
          avatar_url: newProfile.avatar_url,
          updated_at: newProfile.updated_at,
        },
      });

    } catch (err) {
      request.log.error(err, 'Error during user registration');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred during registration. Please try again.',
      });
    }
  });

  // Login Route
  fastify.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const { email: rawEmail, password: rawPassword } = request.body || {};

    const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
    const password = typeof rawPassword === 'string' ? rawPassword.trim() : '';

    if (!email) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Email is a required field and cannot be empty.',
      });
    }

    if (!password) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Password is a required field and cannot be empty.',
      });
    }

    const trimmedEmail = email.toLowerCase();

    try {
      // 1. Fetch user credentials & profile directly from profiles table
      const user = await prisma.profiles.findUnique({
        where: { email: trimmedEmail },
      });

      if (!user) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid email or password.',
        });
      }

      // 2. Validate password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid email or password.',
        });
      }

      // 3. Sign JWT
      const token = fastify.jwt.sign({ id: user.id, email: user.email });

      // 4. Set HTTP-only Cookie
      reply.setCookie('token', token, {
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      // 5. Return response
      return reply.status(200).send({
        message: 'Login successful',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          contact_no: user.contact_no,
          avatar_url: user.avatar_url,
          show_status: user.show_status,
          read_receipts: user.read_receipts,
          updated_at: user.updated_at,
        },
      });

    } catch (err) {
      request.log.error(err, 'Error during user login');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred during sign-in. Please try again.',
      });
    }
  });

  // Logout Route
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('token', {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    });

    return reply.status(200).send({
      message: 'Logged out successfully',
    });
  });

  // Get Current Profile (Protected Route)
  fastify.get('/me', async (request, reply) => {
    try {
      // Verifies cookie-based or authorization header-based token
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Session has expired or is invalid. Please log in again.',
      });
    }

    try {
      const { id } = request.user;

      const profile = await prisma.profiles.findUnique({
        where: { id },
        select: {
          name: true,
          email: true,
          contact_no: true,
          avatar_url: true,
          show_status: true,
          read_receipts: true,
          updated_at: true,
        },
      });

      if (!profile) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'User profile not found.',
        });
      }

      return reply.status(200).send({
        user: {
          id,
          name: profile.name,
          email: profile.email,
          contact_no: profile.contact_no,
          avatar_url: profile.avatar_url,
          show_status: profile.show_status,
          read_receipts: profile.read_receipts,
          updated_at: profile.updated_at,
        },
      });
    } catch (err) {
      request.log.error(err, 'Error fetching current user profile');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred while fetching your profile.',
      });
    }
  });

  // Update Current Profile (Protected Route)
  fastify.put('/me', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Session has expired or is invalid. Please log in again.',
      });
    }

    try {
      const { id } = request.user;
      const { name, contact_no, avatar_url, show_status, read_receipts } = request.body as { name?: string; contact_no?: string; avatar_url?: string; show_status?: boolean; read_receipts?: boolean };

      if (!name) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Name is required.',
        });
      }

      let finalAvatarUrl: string | null | undefined = avatar_url;

      if (avatar_url && avatar_url.startsWith('data:image/')) {
        const uploadResult = await uploadBase64Image(avatar_url, id);
        if (uploadResult.error) {
          request.log.error({ error: uploadResult.error }, 'Avatar upload failed');
          return reply.status(400).send({
            error: 'Bad Request',
            message: uploadResult.error,
          });
        }
        finalAvatarUrl = uploadResult.publicUrl;
      } else if (!avatar_url || !avatar_url.trim()) {
        finalAvatarUrl = null;
      }

      const currentProfile = await prisma.profiles.findUnique({
        where: { id },
        select: { avatar_url: true }
      });

      const updateData: any = {
        name,
        contact_no,
        avatar_url: finalAvatarUrl,
        updated_at: new Date(),
      };

      // Only update show_status if it's explicitly provided
      if (show_status !== undefined) {
        updateData.show_status = show_status;
      }

      // Only update read_receipts if it's explicitly provided
      if (read_receipts !== undefined) {
        updateData.read_receipts = read_receipts;
      }

      const updated = await prisma.profiles.update({
        where: { id },
        data: updateData,
        select: {
          name: true,
          email: true,
          contact_no: true,
          avatar_url: true,
          show_status: true,
          read_receipts: true,
          updated_at: true,
        }
      });

      if (show_status !== undefined) {
        broadcastShowStatusUpdate(id, updated.show_status).catch((err) => {
          request.log.error({ err }, 'Failed to broadcast show_status update');
        });
      }

      if (
        currentProfile?.avatar_url &&
        finalAvatarUrl !== undefined &&
        currentProfile.avatar_url !== finalAvatarUrl
      ) {
        deleteStorageFile(currentProfile.avatar_url).catch((err) => {
          request.log.error({ err }, 'Failed to clean up old avatar from storage');
        });
      }

      return reply.status(200).send({
        message: 'Profile updated successfully',
        user: {
          id,
          name: updated.name,
          email: updated.email,
          contact_no: updated.contact_no,
          avatar_url: updated.avatar_url,
          show_status: updated.show_status,
          read_receipts: updated.read_receipts,
          updated_at: updated.updated_at,
        }
      });
    } catch (err) {
      request.log.error(err, 'Error updating current user profile');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred while updating your profile.',
      });
    }
  });

  // Delete Current Profile (Protected Route)
  fastify.delete('/me', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Session has expired or is invalid. Please log in again.',
      });
    }

    try {
      const userId = request.user.id;

      // Check if profile exists
      const profile = await prisma.profiles.findUnique({
        where: { id: userId },
      });

      if (!profile) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'User profile not found.',
        });
      }

      // Perform cascading deletion and update in a transaction
      await prisma.$transaction(async (tx) => {
        // 1. Update all messages sent by this user to set sender_id to null (preserving message history)
        await tx.messages.updateMany({
          where: {
            sender_id: userId,
          },
          data: {
            sender_id: null,
          },
        });

        // 2. Delete the user status record
        await tx.user_status.deleteMany({
          where: {
            id: userId,
          },
        });

        // 3. Delete the profile itself (cascading automatically to delete room_members records)
        await tx.profiles.delete({
          where: {
            id: userId,
          },
        });
      });

      // Clear the JWT token cookie
      reply.clearCookie('token', {
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
      });

      return reply.status(200).send({
        message: 'User account deleted successfully.',
      });
    } catch (err) {
      request.log.error(err, 'Error deleting user profile');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An error occurred while deleting your profile.',
      });
    }
  });

  // Verify user exists by email
  fastify.get<{ Params: { email: string } }>('/check/:email', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Session has expired or is invalid. Please log in again.',
      });
    }

    const { email } = request.params;
    if (!email) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Email parameter is required.',
      });
    }

    try {
      const profile = await prisma.profiles.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: {
          id: true,
          name: true,
          email: true,
          avatar_url: true,
        },
      });

      if (!profile) {
        return reply.status(404).send({
          exists: false,
          message: 'No user profile found with the specified email address.',
        });
      }

      return reply.status(200).send({
        exists: true,
        profile,
      });
    } catch (err) {
      request.log.error(err, 'Error verifying email');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to verify email.',
      });
    }
  });
};

export default authRoutes;
