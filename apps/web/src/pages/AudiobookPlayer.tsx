import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAudioPlayer } from "../components/AudioPlayerContext";
import { Loading } from "../components";

export default function AudiobookPlayer() {
  const { assetId = "" } = useParams();
  const navigate = useNavigate();
  const player = useAudioPlayer();
  const openedRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!assetId || openedRef.current === assetId) return;
    openedRef.current = assetId;
    void player.openBook(assetId, { autoplay: true, openSheet: true });
  }, [assetId, player]);

  useEffect(() => {
    if (player.sheetOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current && player.book?.asset_id === assetId) {
      navigate(player.book.work_id ? `/books/${player.book.work_id}` : "/library", {
        replace: true,
      });
    }
  }, [assetId, navigate, player.book, player.sheetOpen]);

  if (player.loading && !player.book) return <Loading />;

  if (player.error && !player.book) {
    return (
      <div className="listen-page">
        <div>
          <p role="alert">{player.error}</p>
          <Link to="/library">Return to library</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="listen-page">
      <div>
        <p>Playing {player.book?.title ?? "audiobook"}.</p>
        <button
          type="button"
          className="nn-pill-btn"
          onClick={player.openSheet}
        >
          Open Now Playing
        </button>
      </div>
    </div>
  );
}
