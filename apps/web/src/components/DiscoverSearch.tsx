import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import SearchFormatTabs, {
  savedFormat,
  searchUrl,
  type SearchFormat,
} from "./SearchFormatTabs";

export default function DiscoverSearch() {
  const navigate = useNavigate();
  const [format, setFormat] = useState<SearchFormat>(savedFormat);
  const [q, setQ] = useState("");
  return (
    <section className="discover-search" aria-label="Find a book">
      <SearchFormatTabs value={format} onChange={setFormat} />
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (q.trim()) navigate(searchUrl(q, format));
        }}
      >
        <Search size={22} aria-hidden="true" />
        <input
          aria-label="Search books or authors"
          placeholder={
            format === "audiobook"
              ? "Search audiobooks by title or author"
              : "Search e-books by title or author"
          }
          maxLength={300}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="submit"
          className="hero-button solid"
          disabled={!q.trim()}
        >
          Search
        </button>
      </form>
    </section>
  );
}
