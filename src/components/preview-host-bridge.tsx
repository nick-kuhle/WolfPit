/**
 * Mount once in `__root.tsx` so the Grok preview chrome can drive navigation
 * (and later receive registered routes). Noops when the app is not embedded.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  collectRoutePathsFromTree,
  installPreviewHostBridge,
} from "@/lib/preview-host-bridge";

export function PreviewHostBridge() {
  const router = useRouter();
  const ref = useRef(router);
  ref.current = router;

  useEffect(() => {
    return installPreviewHostBridge({
      navigate: (path) => {
        ref.current.history.push(path);
      },
      getRoutePaths: () => collectRoutePathsFromTree(ref.current.routeTree),
    });
  }, []);

  return null;
}
