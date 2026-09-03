export const MAX_PREVIEWS = 5;
export const PREVIEW_WIDTH = 320;
export const PREVIEW_HEIGHT = 180;

const PREVIEW_TYPE = "image/jpeg";
const PREVIEW_QUALITY = 0.5;

export function updatePreviewCache(
  cache,
  tabId,
  dataUrl,
  keepIds,
  maximum = MAX_PREVIEWS
) {
  const keep = new Set(keepIds.slice(0, maximum).map(String));
  const next = {};

  for (const [id, preview] of Object.entries({ ...cache, [tabId]: dataUrl })) {
    if (keep.has(id)) next[id] = preview;
  }
  return next;
}

export function removePreview(cache, tabId) {
  const next = { ...cache };
  delete next[tabId];
  return next;
}

export async function downscalePreview(dataUrl) {
  const source = await fetch(dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(source);

  try {
    const canvas = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Unable to create preview canvas");

    const sourceRatio = bitmap.width / bitmap.height;
    const targetRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;

    if (sourceRatio > targetRatio) {
      sourceWidth = bitmap.height * targetRatio;
      sourceX = (bitmap.width - sourceWidth) / 2;
    } else {
      sourceHeight = bitmap.width / targetRatio;
      sourceY = (bitmap.height - sourceHeight) / 2;
    }

    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      PREVIEW_WIDTH,
      PREVIEW_HEIGHT
    );

    const preview = await canvas.convertToBlob({
      type: PREVIEW_TYPE,
      quality: PREVIEW_QUALITY
    });
    return blobToDataUrl(preview);
  } finally {
    bitmap.close();
  }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
