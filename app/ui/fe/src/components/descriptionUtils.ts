export const DESCRIPTION_MAX_LENGTH = 200;

export function needsTruncation(description: string | undefined): boolean {
  if (!description) return false;
  return description.length > DESCRIPTION_MAX_LENGTH;
}

export function truncateDescription(description: string | undefined): string {
  if (!description) return '';
  if (description.length <= DESCRIPTION_MAX_LENGTH) return description;
  return description.slice(0, DESCRIPTION_MAX_LENGTH).trimEnd() + '...';
}
