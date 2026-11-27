/** Which decrypted files can be shown in the browser, by extension. */
export type PreviewKind = "image" | "pdf" | "video" | "audio" | "text";

const TYPES: Record<string, { kind: PreviewKind; mime: string }> = {};
const add = (kind: PreviewKind, mime: string, exts: string[]) => exts.forEach((e) => (TYPES[e] = { kind, mime }));

add("image", "image/png", ["png"]);
add("image", "image/jpeg", ["jpg", "jpeg"]);
add("image", "image/gif", ["gif"]);
add("image", "image/webp", ["webp"]);
add("image", "image/avif", ["avif"]);
add("image", "image/bmp", ["bmp"]);
add("image", "image/svg+xml", ["svg"]); // shown via <img>, where scripts never run
add("pdf", "application/pdf", ["pdf"]);
add("video", "video/mp4", ["mp4", "m4v"]);
add("video", "video/webm", ["webm"]);
add("video", "video/quicktime", ["mov"]);
add("audio", "audio/mpeg", ["mp3"]);
add("audio", "audio/wav", ["wav"]);
add("audio", "audio/ogg", ["ogg", "oga"]);
add("audio", "audio/mp4", ["m4a"]);
add("audio", "audio/flac", ["flac"]);
// Text is always rendered as plain text (never as HTML), so .html files are safe to show.
add("text", "text/plain", [
  "txt", "md", "csv", "tsv", "log", "json", "xml", "yml", "yaml", "toml", "ini", "env",
  "html", "css", "js", "jsx", "ts", "tsx", "py", "java", "c", "h", "cpp", "go", "rs", "sql", "sh", "rb", "php",
]);

/** Text bigger than this is not rendered (offer download instead). */
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

export function previewType(name: string | null): { kind: PreviewKind; mime: string } | null {
  const ext = name?.split(".").pop()?.toLowerCase();
  return (ext && name!.includes(".") && TYPES[ext]) || null;
}
