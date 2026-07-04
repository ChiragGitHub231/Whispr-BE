import { Buffer } from 'buffer';

export interface UploadResult {
  publicUrl: string;
  error?: string;
}

export async function uploadBase64Image(
  base64DataUrl: string,
  userId: string
): Promise<UploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    return {
      publicUrl: '',
      error: 'Supabase API key is missing. Please configure SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY in your .env file.',
    };
  }

  // 1. Parse base64DataUrl
  // Format: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...
  const match = base64DataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    return { publicUrl: '', error: 'Invalid Base64 image data URL format.' };
  }

  const mimeType = match[1];
  const base64Data = match[2];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch (err: any) {
    return { publicUrl: '', error: `Failed to decode Base64 data: ${err.message}` };
  }

  // Determine file extension from mime type
  let extension = 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    extension = 'jpg';
  } else if (mimeType.includes('gif')) {
    extension = 'gif';
  } else if (mimeType.includes('webp')) {
    extension = 'webp';
  } else if (mimeType.includes('svg')) {
    extension = 'svg';
  }

  const bucketName = 'whispr_assets_storage';
  const filename = `profile_avatar/${userId}_${Date.now()}.${extension}`;

  try {
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucketName}/${filename}`;

    // Native fetch is supported in modern Node.js
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: buffer as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError;
      try {
        parsedError = JSON.parse(errorText);
      } catch (_) { }
      const errorMsg = parsedError?.message || errorText || response.statusText;
      return { publicUrl: '', error: `Supabase Storage upload failed: ${response.status} - ${errorMsg}` };
    }

    // Public URL format for public buckets in Supabase:
    // https://[project_id].supabase.co/storage/v1/object/public/[bucket_name]/[path_to_file]
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${filename}`;
    return { publicUrl };
  } catch (err: any) {
    return { publicUrl: '', error: err.message || 'Network error during storage upload.' };
  }
}

export async function deleteStorageFile(publicUrl: string): Promise<{ success: boolean; error?: string }> {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://qkygahwqzbomgxuyaulz.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    return { success: false, error: 'Supabase Key missing.' };
  }

  try {
    // Extract bucket and path from the public URL
    // Format: https://[ref].supabase.co/storage/v1/object/public/[bucket]/[path]
    const prefix = `${supabaseUrl}/storage/v1/object/public/`;
    if (!publicUrl.startsWith(prefix)) {
      return { success: false, error: 'URL does not match Supabase public URL structure.' };
    }

    const pathPart = publicUrl.substring(prefix.length);
    const firstSlashIndex = pathPart.indexOf('/');
    if (firstSlashIndex === -1) {
      return { success: false, error: 'Invalid Supabase URL path structure.' };
    }

    const bucketName = pathPart.substring(0, firstSlashIndex);
    const filePath = pathPart.substring(firstSlashIndex + 1);

    const deleteUrl = `${supabaseUrl}/storage/v1/object/${bucketName}/${filePath}`;

    const response = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Supabase Storage delete failed: ${response.statusText} (${errorText})` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error deleting file.' };
  }
}

export async function uploadBase64Attachment(
  base64DataUrl: string,
  roomId: string,
  userId: string,
  originalName?: string
): Promise<UploadResult> {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseKey) {
    return {
      publicUrl: '',
      error: 'Supabase API key is missing. Please configure SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY in your .env file.',
    };
  }

  // 1. Parse base64DataUrl (handles image, video, application, etc.)
  const match = base64DataUrl.match(/^data:([a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) {
    return { publicUrl: '', error: 'Invalid Base64 data URL format.' };
  }

  const mimeType = match[1];
  const base64Data = match[2];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch (err: any) {
    return { publicUrl: '', error: `Failed to decode Base64 data: ${err.message}` };
  }

  // Enforce 50MB file size limit (52,428,800 bytes)
  const maxBytes = 50 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return { publicUrl: '', error: 'File size is too large (maximum 50MB).' };
  }

  // 2. Classify media type & determine extension
  let mediaFolder = 'files';
  let extension = 'bin';

  if (mimeType.startsWith('image/')) {
    mediaFolder = 'images';
    extension = mimeType.split('/')[1] || 'png';
  } else if (mimeType.startsWith('video/')) {
    mediaFolder = 'videos';
    extension = mimeType.split('/')[1] || 'mp4';
  } else if (mimeType.startsWith('audio/')) {
    mediaFolder = 'audio';
    extension = mimeType.split('/')[1] || 'mp3';
  } else if (mimeType.includes('pdf')) {
    mediaFolder = 'documents';
    extension = 'pdf';
  }

  // Sanitize originalName (remove special chars, replace spaces with underscores)
  let cleanOriginalName = 'file';
  if (originalName) {
    const lastDotIndex = originalName.lastIndexOf('.');
    const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
    cleanOriginalName = nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  const bucketName = 'whispr_assets_storage';
  // Virtual path structure: attachments/rooms/{roomId}/{mediaFolder}/{userId}_{timestamp}_{cleanOriginalName}.{extension}
  const filename = `attachments/rooms/${roomId}/${mediaFolder}/${userId}_${Date.now()}_${cleanOriginalName}.${extension}`;

  try {
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucketName}/${filename}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: buffer as any,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError;
      try {
        parsedError = JSON.parse(errorText);
      } catch (_) {}
      const errorMsg = parsedError?.message || errorText || response.statusText;
      return { publicUrl: '', error: `Supabase Storage upload failed: ${response.status} - ${errorMsg}` };
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${filename}`;
    return { publicUrl };
  } catch (err: any) {
    return { publicUrl: '', error: err.message || 'Network error during storage upload.' };
  }
}

