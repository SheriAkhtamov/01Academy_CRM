import { PortalSheetContent as SheetContent } from '@/features/learning-content/modal-content';
import { useState } from 'react';
import { useInfiniteQuery,useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { learningCapabilitiesQuery } from '@/features/learning-rollout/api';
import { UnsavedChangesDialog,useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Sheet,SheetHeader,SheetTitle } from '@/components/ui/sheet';
import { portalFinanceApi } from './api';
import { PaymentAllocationDialog } from './PaymentAllocationDialog';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';
function QuestionSheet({id,onClose}:{id:number;onClose:()=>void}) {
  const {t}=useTranslation(),client=useQueryClient();
  const [body,setBody]=useState(''),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
  const query=useQuery({queryKey:['portal-finance','question',id],queryFn:()=>portalFinanceApi.question(id)});
  const reply=useMutation({mutationFn:()=>portalFinanceApi.reply(id,body.trim(),requestKey),onSuccess:data=>{client.setQueryData(['portal-finance','question',id],data);void client.invalidateQueries({queryKey:['portal-finance','questions']});setBody('');setRequestKey(crypto.randomUUID());}});
  const guard=useUnsavedChangesGuard({open:true,isDirty:body.trim()!=='',isPending:reply.isPending,onOpenChange:open=>{if(!open)onClose();}});
  return <><Sheet open onOpenChange={guard.handleOpenChange}><SheetContent className="flex w-full flex-col sm:max-w-xl"><SheetHeader><SheetTitle>{query.data?.subject ?? t('lmsFinanceQuestionsTitle')}</SheetTitle></SheetHeader>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">{query.isPending?<p role="status"><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p>:query.isError?<div role="alert"><p>{t('portalLoadError')}</p><Button onClick={()=>void query.refetch()}>{t('retry')}</Button></div>:query.data?.messages.map(message=><article key={message.id} className="space-y-1 rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t(message.author==='staff'?'lmsFinanceQuestionReply':'lmsFinanceQuestionsTitle')}</p><p className="whitespace-pre-wrap break-words">{message.body}</p></article>)}</div>
    <form className="grid gap-3 border-t pt-4" onSubmit={event=>{event.preventDefault();if(body.trim())reply.mutate();}}><label className="grid gap-2">{t('lmsFinanceQuestionReply')}<Textarea value={body} maxLength={10000} onChange={event=>{setBody(event.target.value);setRequestKey(crypto.randomUUID());}} disabled={reply.isPending}/></label>{reply.isError?<p role="alert" className="text-destructive">{t('portalSaveError')}</p>:null}<Button loading={reply.isPending} type="submit" disabled={!body.trim() || reply.isPending || !query.data}>{t(reply.isPending?'loading':'portalSend')}</Button></form>
  </SheetContent></Sheet><UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges}/></>;
}
export function PortalFinancePanel({money}:{money:(value:number)=>string}) {
  const {t}=useTranslation();
  const status=useQuery(learningCapabilitiesQuery),enabled=status.data?.learningEnabled===true;
  const [paymentId,setPaymentId]=useState<number|null>(null),[questionId,setQuestionId]=useState<number|null>(null);
  const unallocated=useInfiniteQuery({queryKey:['portal-finance','unallocated'],queryFn:({pageParam})=>portalFinanceApi.unallocated(pageParam),initialPageParam:null as number|null,getNextPageParam:page=>page.nextCursor ?? undefined,enabled});
  const questions=useInfiniteQuery({queryKey:['portal-finance','questions'],queryFn:({pageParam})=>portalFinanceApi.questionsPage(pageParam),initialPageParam:null as number|null,getNextPageParam:page=>page.nextCursor ?? undefined,enabled,refetchInterval:30_000});
  const questionItems=questions.data?.pages.flatMap(page=>page.items) ?? [];
  if(!enabled)return null;
  return <><div className="grid min-w-0 gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>{t('lmsPaymentAllocationUnresolved')}</CardTitle></CardHeader><CardContent className="grid gap-3">
    {unallocated.isPending?<p role="status"><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p>:unallocated.isError?<div role="alert"><p>{t('portalLoadError')}</p><Button onClick={()=>void unallocated.refetch()}>{t('retry')}</Button></div>:unallocated.data?.pages.flatMap(page=>page.items).map(payment=><div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="break-words font-medium">{payment.name ?? t('lmsPaymentAllocationEmpty')}</p><p className="tabular-nums">{money(payment.amountUzs)}</p></div><Button variant="outline" onClick={()=>setPaymentId(payment.id)}>{t('lmsPaymentAllocationAction')}</Button></div>)}
    {unallocated.data?.pages.every(page=>page.items.length===0)?<p>{t('portalNoPayments')}</p>:null}{unallocated.hasNextPage?<Button loading={unallocated.isFetchingNextPage} variant="outline" disabled={unallocated.isFetchingNextPage} onClick={()=>void unallocated.fetchNextPage()}>{t('loadMoreResults')}</Button>:null}
  </CardContent></Card><Card><CardHeader><CardTitle>{t('lmsFinanceQuestionsTitle')}</CardTitle></CardHeader><CardContent className="grid gap-3">{questions.isPending?<p role="status"><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p>:questions.isError?<div role="alert"><p>{t('portalLoadError')}</p><Button onClick={()=>void questions.refetch()}>{t('retry')}</Button></div>:questionItems.length?questionItems.map(question=><Button key={question.id} variant="outline" className="h-auto min-h-11 flex-wrap justify-between gap-2 whitespace-normal text-left" onClick={()=>setQuestionId(question.id)}><span className="min-w-0 break-words">{question.studentName}: {question.subject}</span><Badge variant="secondary">{t(question.status==='open'?'portalOpenQuestion':'portalAnswered')}</Badge></Button>):<p>{t('lmsFinanceQuestionEmpty')}</p>}{questions.hasNextPage?<Button loading={questions.isFetchingNextPage} variant="outline" disabled={questions.isFetchingNextPage} onClick={()=>void questions.fetchNextPage()}>{t('loadMoreResults')}</Button>:null}</CardContent></Card></div>
    {paymentId?<PaymentAllocationDialog key={paymentId} paymentId={paymentId} onClose={()=>setPaymentId(null)} money={money}/>:null}{questionId?<QuestionSheet key={questionId} id={questionId} onClose={()=>setQuestionId(null)}/>:null}
  </>;
}
