/**
 * Image Compression Utility
 * Client-side compression following best practices:
 * - Uses Canvas API (no external dependencies)
 * - Converts to WebP for better compression (fallback to JPEG)
 * - Configurable quality and max dimensions per use case
 * - Returns compressed File ready for upload
 */

export interface CompressOptions {
  /** Maximum width in pixels */
  maxWidth: number;
  /** Maximum height in pixels */
  maxHeight: number;
  /** JPEG/WebP quality 0-1 */
  quality: number;
  /** Output format */
  format?: "webp" | "jpeg" | "png";
}

export interface CompressResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  width: number;
  height: number;
  format: string;
}

/** Presets for different use cases */
export const COMPRESS_PRESETS: Record<string, CompressOptions> = {
  /** Profile avatar: small, square, high quality */
  avatar: {
    maxWidth: 400,
    maxHeight: 400,
    quality: 0.85,
    format: "webp",
  },
  /** Cover/banner: wide, medium quality */
  cover: {
    maxWidth: 1200,
    maxHeight: 600,
    quality: 0.8,
    format: "webp",
  },
  /** Wall post image: medium size, good quality */
  wallPost: {
    maxWidth: 1200,
    maxHeight: 900,
    quality: 0.82,
    format: "webp",
  },
  /** Story: full height, medium quality */
  story: {
    maxWidth: 1080,
    maxHeight: 1920,
    quality: 0.78,
    format: "webp",
  },
  /** Chat/share: smaller, faster loading */
  chat: {
    maxWidth: 800,
    maxHeight: 800,
    quality: 0.75,
    format: "webp",
  },
  /** Thumbnail: very small */
  thumbnail: {
    maxWidth: 200,
    maxHeight: 200,
    quality: 0.8,
    format: "webp",
  },
};

/**
 * Load an image file into an HTMLImageElement
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/**
 * Calculate resized dimensions maintaining aspect ratio
 */
function calculateDimensions(
  origWidth: number,
  origHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (origWidth <= maxWidth && origHeight <= maxHeight) {
    return { width: origWidth, height: origHeight };
  }

  const ratio = Math.min(maxWidth / origWidth, maxHeight / origHeight);
  return {
    width: Math.round(origWidth * ratio),
    height: Math.round(origHeight * ratio),
  };
}

/**
 * Detect if browser supports WebP output
 */
let webpSupported: boolean | null = null;
function isWebPSupported(): boolean {
  if (webpSupported !== null) return webpSupported;
  try {
    const canvas = document.createElement("canvas");
    webpSupported = canvas.toDataURL("image/webp").indexOf("data:image/webp") === 0;
  } catch {
    webpSupported = false;
  }
  return webpSupported;
}

/**
 * Compress an image file
 */
export async function compressImage(
  file: File,
  options: CompressOptions
): Promise<CompressResult> {
  // Skip compression for non-image files or very small files
  if (!file.type.startsWith("image/") || file.size < 10 * 1024) {
    return {
      file,
      originalSize: file.size,
      compressedSize: file.size,
      compressionRatio: 1,
      width: 0,
      height: 0,
      format: file.type,
    };
  }

  // Skip compression for SVG and GIF (animated)
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return {
      file,
      originalSize: file.size,
      compressedSize: file.size,
      compressionRatio: 1,
      width: 0,
      height: 0,
      format: file.type,
    };
  }

  const img = await loadImage(file);
  const { width, height } = calculateDimensions(
    img.naturalWidth,
    img.naturalHeight,
    options.maxWidth,
    options.maxHeight
  );

  // Use Canvas for compression
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d")!;
  // High quality scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // Determine output format
  let mimeType = "image/jpeg";
  let extension = "jpg";

  if (options.format === "webp" && isWebPSupported()) {
    mimeType = "image/webp";
    extension = "webp";
  } else if (options.format === "png") {
    mimeType = "image/png";
    extension = "png";
  }

  // Convert to blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Failed to compress image"));
      },
      mimeType,
      options.quality
    );
  });

  const compressedFile = new File([blob], `${file.name.split(".")[0]}.${extension}`, {
    type: mimeType,
    lastModified: Date.now(),
  });

  return {
    file: compressedFile,
    originalSize: file.size,
    compressedSize: compressedFile.size,
    compressionRatio: compressedFile.size / file.size,
    width,
    height,
    format: mimeType,
  };
}

/**
 * Compress multiple images
 */
export async function compressImages(
  files: File[],
  options: CompressOptions
): Promise<CompressResult[]> {
  return Promise.all(files.map((f) => compressImage(f, options)));
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get compression summary for display
 */
export function getCompressionSummary(result: CompressResult): string {
  if (result.compressionRatio >= 1) return "بدون ضغط";
  const saved = ((1 - result.compressionRatio) * 100).toFixed(0);
  return `تم الضغط ${saved}% (${formatFileSize(result.originalSize)} → ${formatFileSize(result.compressedSize)})`;
}
