"use client";

import { useMemo, useState } from "react";

type SiteFaviconProps = {
  url: string;
  faviconUrl?: string | null;
  alt: string;
  className?: string;
};

export function SiteFavicon({ url, faviconUrl, alt, className = "site-favicon" }: SiteFaviconProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const hostnameLabel = useMemo(() => getHostnameLabel(url), [url]);
  const src = !imageFailed ? faviconUrl ?? buildFallbackServiceUrl(url) : null;

  if (!src) {
    return <div className={`${className} site-favicon--fallback`} aria-hidden="true">{hostnameLabel}</div>;
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
    />
  );
}

function getHostnameLabel(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    return hostname.slice(0, 1).toUpperCase() || "?";
  } catch {
    return "?";
  }
}

function buildFallbackServiceUrl(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(hostname)}`;
  } catch {
    return null;
  }
}
