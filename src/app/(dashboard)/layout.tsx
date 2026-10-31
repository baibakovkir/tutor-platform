import { auth } from "../../../auth";
import { redirect } from "next/navigation";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await auth())?.user?.id) redirect("/signin");
  return children;
}
