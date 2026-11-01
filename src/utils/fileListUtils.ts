export function getFileIdentityKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}-${file.type}`;
}
