import { redirect } from "react-router";

// Old URL kept so existing links keep working.
export const loader = ({ request }) => {
  const url = new URL(request.url);
  throw redirect(`/app/import${url.search}`);
};
