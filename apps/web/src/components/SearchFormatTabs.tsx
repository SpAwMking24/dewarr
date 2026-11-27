import { BookOpen, Headphones } from "lucide-react";

export type SearchFormat = "ebook" | "audiobook";
const key = "dewarr:search-format";

export function savedFormat(): SearchFormat {
  try {
    return localStorage.getItem(key) === "audiobook" ? "audiobook" : "ebook";
  } catch {
    return "ebook";
  }
}

export function rememberFormat(format: SearchFormat) {
  try {
    localStorage.setItem(key, format);
  } catch {
    /* storage unavailable */
  }
}

export function searchUrl(q: string, format: SearchFormat) {
  const base = "/search?q=" + encodeURIComponent(q.trim());
  return format === "audiobook" ? base + "&provider=audible" : base;
}

export default function SearchFormatTabs({
  value,
  onChange,
}: {
  value: SearchFormat;
  onChange: (format: SearchFormat) => void;
}) {
  return (
    <div className="format-tabs" role="tablist" aria-label="Search format">
      {(
        [
          ["ebook", "E-book", BookOpen],
          ["audiobook", "AudioBook", Headphones],
        ] as const
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => {
            rememberFormat(id);
            onChange(id);
          }}
        >
          <Icon size={16} aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
}
