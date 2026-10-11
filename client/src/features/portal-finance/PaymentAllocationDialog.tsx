import { PortalDialogContent as DialogContent, PortalAlertDialogContent as AlertDialogContent } from '@/features/learning-content/modal-content';
import { useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import type { PortalPaymentAllocationDto } from '@shared/contracts/portal-resources';
import { useTranslation } from '@/hooks/useTranslation';
import { CurrencyInput } from '@/components/ux/FormattedInputs';
import { UnsavedChangesDialog,useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle } from '@/components/ui/alert-dialog';
import { portalFinanceApi,PortalFinanceApiError } from './api';
function AllocationForm({context,onClose,money}:{context:PortalPaymentAllocationDto;onClose:()=>void;money:(value:number)=>string}) {
  const {t}=useTranslation(),client=useQueryClient();
  const [baseline]=useState(context);
  const [amounts,setAmounts]=useState(()=>Object.fromEntries(context.students.map(student=>[student.id,String(student.amountUzs || '')])));
  const [reason,setReason]=useState(''),[confirm,setConfirm]=useState(false);
  const total=Object.values(amounts).reduce((sum,value)=>sum+Number(value || 0),0);
  const dirty=reason!=='' || baseline.students.some(student=>Number(amounts[student.id]||0)!==student.amountUzs);
  const save=useMutation({mutationFn:()=>portalFinanceApi.saveAllocation(context.paymentId,{version:baseline.version,reason,allocations:baseline.students.filter(student=>Number(amounts[student.id]||0)>0).map(student=>({studentId:student.id,amountUzs:Number(amounts[student.id])}))}),onSuccess:()=>{void client.invalidateQueries({queryKey:['portal-finance']});void client.invalidateQueries({queryKey:['finance']});onClose();}});
  const guard=useUnsavedChangesGuard({open:true,isDirty:dirty,isPending:save.isPending,onOpenChange:open=>{if(!open)onClose();}});
  return <><Dialog open onOpenChange={guard.handleOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{t('lmsPaymentAllocationTitle')}</DialogTitle></DialogHeader>
    <dl className="flex flex-wrap justify-between gap-4"><dt>{t('lmsPaymentAllocationTotal')}</dt><dd className="font-semibold tabular-nums">{money(baseline.amountUzs)}</dd></dl>
    <div className="space-y-3">{baseline.students.length?baseline.students.map(student=><label key={student.id} className="grid min-w-0 gap-2"><span className="break-words">{student.name}</span><CurrencyInput value={amounts[student.id]} onValueChange={value=>setAmounts({...amounts,[student.id]:value})} aria-label={student.name} disabled={save.isPending}/></label>):<p>{t('lmsPaymentAllocationEmpty')}</p>}</div>
    <dl className="flex flex-wrap justify-between gap-4"><dt>{t('lmsPaymentAllocationRemaining')}</dt><dd className="tabular-nums">{money(baseline.amountUzs-total)}</dd></dl>
    <label className="grid gap-2">{t('lmsPaymentAllocationReason')}<Textarea maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)} disabled={save.isPending}/></label>
    {total>baseline.amountUzs?<p role="alert" className="text-destructive">{t('lmsPaymentAllocationExceeds')}</p>:null}
    {save.isError?<p role="alert" className="text-destructive">{t(save.error instanceof PortalFinanceApiError && save.error.status===409?'portalIdentityConflict':'portalSaveError')}</p>:null}
    <DialogFooter><Button variant="outline" disabled={save.isPending} onClick={()=>guard.handleOpenChange(false)}>{t('cancel')}</Button><Button disabled={save.isPending || !dirty || total<=0 || total>baseline.amountUzs || reason.trim().length<3} onClick={()=>setConfirm(true)}>{t('save')}</Button></DialogFooter>
  </DialogContent></Dialog><UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges}/>
  <AlertDialog open={confirm} onOpenChange={open=>{if(!save.isPending)setConfirm(open);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('lmsPaymentAllocationConfirm')}</AlertDialogTitle><AlertDialogDescription>{baseline.students.filter(student=>Number(amounts[student.id]||0)>0).map(student=>`${student.name}: ${money(Number(amounts[student.id]))}`).join('; ')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={save.isPending}>{t('cancel')}</AlertDialogCancel><AlertDialogAction disabled={save.isPending} onClick={event=>{event.preventDefault();setConfirm(false);save.mutate();}}>{t('save')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
export function PaymentAllocationDialog({paymentId,onClose,money}:{paymentId:number;onClose:()=>void;money:(value:number)=>string}) {
  const {t}=useTranslation();
  const [opener]=useState(()=>document.activeElement instanceof HTMLElement?document.activeElement:null);
  const finish=()=>{onClose();setTimeout(()=>{if(opener?.isConnected)opener.focus();},0);};
  const query=useQuery({queryKey:['portal-finance','allocation',paymentId],queryFn:()=>portalFinanceApi.allocation(paymentId),gcTime:0});
  if(query.data)return <AllocationForm context={query.data} onClose={finish} money={money}/>;
  return <Dialog open onOpenChange={open=>{if(!open)finish();}}><DialogContent><DialogHeader><DialogTitle>{t('lmsPaymentAllocationTitle')}</DialogTitle></DialogHeader>{query.isError?<div role="alert"><p>{t('portalLoadError')}</p><Button onClick={()=>void query.refetch()}>{t('retry')}</Button></div>:<p role="status">{t('loading')}</p>}</DialogContent></Dialog>;
}
