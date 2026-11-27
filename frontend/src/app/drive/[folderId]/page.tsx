"use client";

import { useParams } from "next/navigation";

import DriveView from "@/components/drive/DriveView";

export default function DriveFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  return <DriveView folderId={folderId} />;
}
