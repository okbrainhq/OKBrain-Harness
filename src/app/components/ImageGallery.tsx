"use client";

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import styles from "./ImageGallery.module.css";

interface ImageItem {
  src: string;
  title: string;
  link?: string;
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'images'; images: ImageItem[]; loading: boolean }
  | { type: 'single-image'; src: string; alt: string; width?: number };

function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  if (url.startsWith('/') || url.startsWith('#')) return true;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return true;
  }
}

const IMAGE_TAG_REGEX = /<image\s+src="([^"]*?)"\s+title="([^"]*?)"\s+link="([^"]*?)"\s*\/?\s*>/g;
const IMG_TAG_REGEX = /<img\b[^>]*\/?>/gi;
const MIN_IMAGE_WIDTH = 100;
const MAX_IMAGE_WIDTH = 1400;

function parseImageTags(block: string): ImageItem[] {
  const images: ImageItem[] = [];
  let match;
  const regex = new RegExp(IMAGE_TAG_REGEX.source, 'g');
  while ((match = regex.exec(block)) !== null) {
    images.push({ src: match[1], title: match[2], link: match[3] });
  }
  return images;
}

function clampWidth(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, parsed));
}

function parseSingleImageTag(tag: string): { src: string; alt: string; width?: number } | null {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*?)"|'([^']*?)')/g;
  let match;

  while ((match = attrRegex.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    attrs[key] = match[2] ?? match[3] ?? "";
  }

  const src = (attrs.src || "").trim();
  if (!src) return null;

  return {
    src,
    alt: (attrs.alt || "").trim(),
    width: clampWidth(attrs.width),
  };
}

function pushTextAndSingleImages(segments: Segment[], text: string): void {
  if (!text) return;

  let lastIndex = 0;
  let match;
  const regex = new RegExp(IMG_TAG_REGEX.source, "gi");

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: "text", content: before });
    }

    const parsed = parseSingleImageTag(match[0]);
    if (parsed) {
      segments.push({ type: "single-image", ...parsed });
    } else {
      const rawTag = match[0].trim();
      if (rawTag) segments.push({ type: "text", content: rawTag });
    }

    lastIndex = match.index + match[0].length;
  }

  const trailing = text.slice(lastIndex).trim();
  if (trailing) {
    segments.push({ type: "text", content: trailing });
  }
}

/**
 * Parse <images> blocks from message content.
 * Incomplete blocks (still streaming) are emitted with loading=true and whatever images parsed so far.
 */
export function parseImageBlocks(content: string): Segment[] {
  const segments: Segment[] = [];
  // Match complete blocks first
  const completeRegex = /<images>([\s\S]*?)<\/images>/g;
  let lastIndex = 0;
  let match;

  while ((match = completeRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      pushTextAndSingleImages(segments, content.slice(lastIndex, match.index));
    }
    const images = parseImageTags(match[1]);
    if (images.length > 0) {
      segments.push({ type: 'images', images, loading: false });
    }
    lastIndex = match.index + match[0].length;
  }

  // Check for an incomplete <images> block at the end (streaming)
  const remaining = content.slice(lastIndex);
  const incompleteIdx = remaining.indexOf('<images>');

  if (incompleteIdx !== -1) {
    pushTextAndSingleImages(segments, remaining.slice(0, incompleteIdx));

    // Parse any complete <image> tags inside the incomplete block
    const partialBlock = remaining.slice(incompleteIdx + '<images>'.length);
    const images = parseImageTags(partialBlock);
    // Always show the gallery container when <images> is opened (even with 0 images yet)
    segments.push({ type: 'images', images, loading: true });
  } else {
    pushTextAndSingleImages(segments, remaining);
  }

  // If nothing was parsed, return full content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content });
  }

  return segments;
}

export function ImageModal({ selectedImage, onClose }: { selectedImage: ImageItem; onClose: () => void }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{selectedImage.title}</span>
          <div className={styles.modalActions}>
            {isSafeUrl(selectedImage.link) && (
              <a
                href={selectedImage.link!}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.sourceLink}
              >
                <ExternalLink size={14} />
                <span>Source</span>
              </a>
            )}
            <button
              className={styles.closeButton}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <img
          src={selectedImage.src}
          alt={selectedImage.title}
          className={styles.modalImage}
        />
      </div>
    </div>
  );
}

export function SingleImage({ src, alt, width }: { src: string; alt?: string; width?: number }) {
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const imageTitle = alt?.trim() || "Image";
  const imageStyle = width ? { maxWidth: `${width}px` } : undefined;

  return (
    <>
      <button
        type="button"
        className={styles.singleImageButton}
        onClick={() => setSelectedImage({ src, title: imageTitle })}
      >
        <img
          src={src}
          alt={imageTitle}
          className={styles.singleImage}
          style={imageStyle}
        />
      </button>

      {selectedImage && (
        <ImageModal
          selectedImage={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </>
  );
}

export default function ImageGallery({ images, loading }: { images: ImageItem[]; loading?: boolean }) {
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);

  return (
    <>
      <div className={styles.gallery}>
        {images.map((img, i) => (
          <button
            key={i}
            className={styles.item}
            onClick={() => setSelectedImage(img)}
          >
            <img src={img.src} alt={img.title} className={styles.image} />
            <span className={styles.title}>{img.title}</span>
          </button>
        ))}
        {loading && (
          <div className={styles.placeholder}>
            <div className={styles.placeholderPulse} />
          </div>
        )}
      </div>

      {selectedImage && (
        <ImageModal
          selectedImage={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </>
  );
}
