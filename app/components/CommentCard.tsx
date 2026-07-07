"use client";

import { useEffect, useState } from "react";
import type { CommentItem } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { HeartIcon } from "./icons";

interface Props {
  comment: CommentItem;
  index: number;
  total: number;
  zoom?: number;
}

/**
 * A single deck card. Rendered with a `key` that changes per card so it remounts
 * on navigation — that resets the avatar-error state and replays the pop
 * animation, matching the reference HTML's re-render-on-flip behaviour.
 *
 * All text (name, comment) is rendered as React children, so it is escaped
 * automatically — no dangerouslySetInnerHTML.
 */
export function CommentCard({ comment, index, total, zoom = 1 }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  // Retry the image whenever the avatar URL changes. The parent normally
  // remounts this card (key includes the index), which resets imgFailed for
  // free — but re-pulling/reopening the same video while parked on the same
  // index keeps the key stable, so reset explicitly on URL change too.
  useEffect(() => {
    setImgFailed(false);
  }, [comment.avatar]);

  const initial = (comment.name || "?").charAt(0).toUpperCase();
  const showAvatar = Boolean(comment.avatar) && !imgFailed;

  return (
    <div className="card" style={{ "--zoom": zoom } as React.CSSProperties}>
      <div className="rank">
        #{index + 1} of {total}
      </div>
      <div className="card-top">
        {showAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote YT avatars; plain <img> matches the reference and avoids remote-image config
          <img
            className="avatar"
            src={comment.avatar}
            alt=""
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="avatar-fallback">{initial}</div>
        )}
        <div className="who">
          <div className="name">{comment.name}</div>
          <div className="when">{timeAgo(comment.when)}</div>
        </div>
        <div className="likes">
          <HeartIcon />
          {comment.likes.toLocaleString()}
        </div>
      </div>
      <div className="comment">{comment.text}</div>
    </div>
  );
}
