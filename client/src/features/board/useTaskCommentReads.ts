import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import type { TaskDetail } from '@/lib/boardTypes';
import { canCommentOnBoardTask } from '@shared/board-permissions';
import { boardApi, boardQueryKeys } from './api';

type SeenComments = { taskId: number; userId: number; throughCommentId: number };

export function useTaskCommentReads(task: TaskDetail | undefined, userId: number | undefined, open: boolean, commentsVisible: boolean) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const seen = useRef<SeenComments | null>(null);
  const mounted = useRef(false);

  const acknowledge = useCallback((taskId: number, throughCommentId: number) => {
    queryClient.setQueryData<TaskDetail>([`/api/board/tasks/${taskId}`], (current) => current ? {
      ...current,
      comments: current.comments.map((comment) => comment.id <= throughCommentId ? { ...comment, isUnread: false } : comment),
    } : current);
    void queryClient.invalidateQueries({ queryKey: boardQueryKeys.all });
  }, [queryClient]);

  const markSeen = useCallback(() => {
    const receipt = seen.current;
    if (!receipt) return;
    seen.current = null;
    void boardApi.markCommentsRead(receipt.taskId, receipt.throughCommentId)
      .then(() => acknowledge(receipt.taskId, receipt.throughCommentId))
      .catch((error: unknown) => toast({ title: error instanceof Error ? error.message : t('errorOccurred'), variant: 'destructive' }));
  }, [acknowledge, toast, t]);

  useEffect(() => {
    if (seen.current && (!open || seen.current.taskId !== task?.id || seen.current.userId !== userId)) markSeen();
    if (!open || !commentsVisible || !task || !userId || !canCommentOnBoardTask({ id: userId }, task)) return;
    const throughCommentId = Math.max(0, ...task.comments.map((comment) => comment.id));
    if (throughCommentId) seen.current = { taskId: task.id, userId, throughCommentId };
  }, [task, userId, open, commentsVisible, markSeen]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current) markSeen(); });
    };
  }, [markSeen]);

  return {
    markSeen,
    getSeenCommentId: () => seen.current?.taskId === task?.id ? seen.current?.throughCommentId ?? 0 : 0,
    acknowledgeReply: (throughCommentId: number) => { if (task) acknowledge(task.id, throughCommentId); },
  };
}
