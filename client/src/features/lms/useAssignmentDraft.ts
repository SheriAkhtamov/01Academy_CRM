import { useCallback, useEffect, useRef, useState } from "react";
import type { LmsDraftDto, LmsDraftInput } from "@shared/contracts/lms";
import { PortalApiError, portalLmsApi } from "../portal-app/api";
import { safeHttps } from "../portal-app/ui";

type Answer = Pick<LmsDraftInput, "text" | "links" | "fileIds">;
const fingerprint = (answer: Answer) =>
  JSON.stringify([answer.text, answer.links, answer.fileIds]);
export function useAssignmentDraft(
  linkId: number,
  id: number,
  initial: LmsDraftDto,
  paused: boolean,
) {
  const [answer, setAnswer] = useState<Answer>({
    text: initial.text,
    links: initial.links,
    fileIds: initial.fileIds,
  });
  const [version, setVersion] = useState(initial.version);
  const versionRef = useRef(initial.version);
  const [saved, setSaved] = useState(fingerprint(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const current = useRef(answer);
  current.current = answer;
  const savedRef = useRef(saved);
  const confirmedFiles = useRef(initial.fileIds);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const request = useRef<Promise<LmsDraftDto> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = fingerprint(answer) !== saved;
  const save = useCallback(async (): Promise<LmsDraftDto> => {
    if (request.current) await request.current;
    const snapshot = pausedRef.current
      ? {
          ...current.current,
          fileIds: current.current.fileIds.filter((id) =>
            confirmedFiles.current.includes(id),
          ),
        }
      : current.current;
    if (fingerprint(snapshot) === savedRef.current)
      return {
        ...snapshot,
        version: versionRef.current,
        savedAt: initial.savedAt,
      };
    if (!snapshot.links.every(safeHttps))
      throw new PortalApiError(422, "portalInvalidUrl");
    const expected = versionRef.current;
    if (mounted.current) {
      setSaving(true);
      setError(null);
    }
    const promise = portalLmsApi.draft(linkId, id, {
      ...snapshot,
      version: expected,
    });
    request.current = promise;
    try {
      const result = await promise;
      versionRef.current = result.version;
      savedRef.current = fingerprint(snapshot);
      confirmedFiles.current = snapshot.fileIds;
      if (mounted.current) {
        setVersion(result.version);
        setSaved(savedRef.current);
      }
      return result;
    } catch (failure) {
      if (mounted.current) setError(failure);
      throw failure;
    } finally {
      request.current = null;
      if (mounted.current) setSaving(false);
    }
  }, [linkId, id, initial.savedAt]);
  useEffect(() => {
    const persistable = paused
      ? {
          ...answer,
          fileIds: answer.fileIds.filter((id) =>
            confirmedFiles.current.includes(id),
          ),
        }
      : answer;
    if (
      !dirty ||
      saving ||
      error ||
      fingerprint(persistable) === savedRef.current ||
      !answer.links.every(safeHttps)
    )
      return;
    const timeout = setTimeout(() => {
      void save().catch(() => {});
    }, 2000);
    return () => clearTimeout(timeout);
  }, [answer, dirty, paused, saving, error, save]);
  const reload = useCallback(async () => {
    const latest = (await portalLmsApi.assignment(linkId, id)).draft;
    versionRef.current = latest.version;
    savedRef.current = fingerprint(latest);
    confirmedFiles.current = latest.fileIds;
    if (mounted.current) {
      setAnswer({
        text: latest.text,
        links: latest.links,
        fileIds: latest.fileIds,
      });
      setVersion(latest.version);
      setSaved(savedRef.current);
      setError(null);
    }
    return latest;
  }, [linkId, id]);
  return { answer, setAnswer, version, dirty, saving, error, save, reload };
}
