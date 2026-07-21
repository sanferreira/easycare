export function toDateInputValue(value: Date | string | null | undefined = new Date()): string {
  if (typeof value === "string") {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  }

  const date = value instanceof Date ? value : new Date(value ?? new Date());
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toMonthInputValue(value: Date | string | null | undefined = new Date()): string {
  const dateKey = toDateInputValue(value);
  return dateKey ? dateKey.slice(0, 7) : "";
}
