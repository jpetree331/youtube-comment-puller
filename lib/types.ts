// Shape of a single top-level comment, shared by the API route and the client.
export interface CommentItem {
  name: string;
  avatar: string;
  text: string;
  likes: number;
  when: string; // ISO 8601 publishedAt timestamp
}

// JSON payload returned by POST /api/comments.
export interface DeckResponse {
  title: string;
  videoId: string;
  comments: CommentItem[];
}
