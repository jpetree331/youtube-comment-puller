// Shape of a single top-level comment, shared by the API route and the client.
export interface CommentItem {
  name: string;
  avatar: string;
  text: string;
  likes: number;
  when: string; // ISO 8601 publishedAt timestamp
}

// Which selection of comments a pull returns:
//   likes   — re-sorted by like count (the true "most-hearted")
//   youtube — YouTube's own relevance order (what the site shows)
//   random  — a random sample of the fetched pool
export type PullMode = "likes" | "youtube" | "random";

// JSON payload returned by POST /api/comments.
export interface DeckResponse {
  title: string;
  videoId: string;
  comments: CommentItem[];
  commentCount: number | null; // total comments on the video (null if unknown/disabled)
}
