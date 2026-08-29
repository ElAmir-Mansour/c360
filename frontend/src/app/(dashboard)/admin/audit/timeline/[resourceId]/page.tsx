"use client";


import { useParams } from "next/navigation";
import { ResourceTimeline } from "./_components/resource-timeline";

export default function ResourceTimelinePage() {
  const params = useParams<{ resourceId: string }>();
  const resourceId = params?.resourceId ?? "";

  return <ResourceTimeline resourceId={resourceId} />;
}
