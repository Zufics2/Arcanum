// Base URL of the Django API. Behind nginx it is same-origin ("/api");
// for `npm run dev` without nginx set NEXT_PUBLIC_API_URL=http://localhost:8000/api.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";
