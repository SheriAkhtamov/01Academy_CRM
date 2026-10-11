import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { safeHttps } from "../portal-app/ui";

export function portalVideoEmbed(source: string): string | null {
  if (!safeHttps(source)) return null;
  const url = new URL(source);
  if (["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname)) {
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)$/)?.[1];
    return id && /^[\w-]{11}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  }
  if (
    ["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)
  ) {
    const id = url.pathname.match(/^\/(?:video\/)?(\d+)\/?$/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}
export function PortalVideo({
  source,
  title,
}: {
  source: string;
  title: string;
}) {
  const { t } = useTranslation();
  const [play, setPlay] = useState(false);
  const embed = portalVideoEmbed(source);
  if (!safeHttps(source)) return null;
  return (
    <section className="space-y-3">
      {embed &&
        (play ? (
          <iframe
            src={embed}
            title={title}
            className="aspect-video w-full rounded-lg border"
            allow="fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <Button className="min-h-11" onClick={() => setPlay(true)}>
            {t("portalPlayVideo")}
          </Button>
        ))}
      <Button asChild variant="outline" className="min-h-11">
        <a href={source} target="_blank" rel="noopener noreferrer">
          {t("portalOpenVideoSource")}
        </a>
      </Button>
    </section>
  );
}
