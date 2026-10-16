import { useCallback } from "react";
import { useLocation } from "wouter";
import {
  isLegacyLearningPath,
  learningModuleFromPath,
  learningSectionPath,
  toLearningModuleHref,
} from "@shared/platform-routes";

/** Navigation belongs to the selected platform module, including old stored links. */
export function usePortalLocation(): ReturnType<typeof useLocation> {
  const [path, navigate] = useLocation();
  const module = learningModuleFromPath(path);
  const go = useCallback<typeof navigate>(
    (href, options) =>
      navigate(
        module && typeof href === "string" && isLegacyLearningPath(href)
          ? toLearningModuleHref(href, module)
          : href,
        options,
      ),
    [module, navigate],
  );
  return [learningSectionPath(path), go];
}
