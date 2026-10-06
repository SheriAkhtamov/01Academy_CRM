// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../client/src/lib/i18n';
import type { ChatGroupDto, GroupMessageDto } from '../shared/contracts/chat-groups';
const mocks=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../client/src/lib/queryClient',async()=>({...await vi.importActual('../client/src/lib/queryClient'),apiRequest:mocks.api}));
vi.mock('../client/src/hooks/useAuth',()=>({useAuth:()=>({user:{id:1,fullName:'Me'}})}));
import ChatSheet from '../client/src/components/ux/ChatSheet';
let client:QueryClient;
let groups:ChatGroupDto[];
let messages:GroupMessageDto[];
beforeEach(()=>{
  vi.clearAllMocks();i18n.setLanguage('en');groups=[];messages=[];
  Element.prototype.scrollIntoView=vi.fn();Element.prototype.hasPointerCapture=()=>false;Element.prototype.setPointerCapture=()=>undefined;Element.prototype.releasePointerCapture=()=>undefined;
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  mocks.api.mockImplementation(async(method:string,path:string,data:any)=>{
    if (method==='GET' && path==='/api/users') return [{id:1,fullName:'Me',isActive:true},{id:2,fullName:'Alice',isActive:true},{id:3,fullName:'Bob',isActive:true}];
    if (method==='GET' && path==='/api/chat-groups') return groups;
    if (method==='GET' && path.endsWith('/messages')) return messages;
    if (method==='GET') return [];
    if (method==='POST' && path==='/api/chat-groups') {const group={id:10,name:data.name,createdBy:1,participantCount:data.participantIds.length+1,unreadCount:0};groups=[group];return group;}
    if (method==='POST') {const message={id:20,groupId:10,senderId:1,senderName:'Me',content:data.content,attachments:[],createdAt:'2026-10-06T17:00:00Z'};messages=[...messages,message];return message;}
    return {success:true};
  });
  client=new QueryClient({defaultOptions:{queries:{retry:false,queryFn:({queryKey})=>mocks.api('GET',queryKey[0])}}});
});
afterEach(()=>{cleanup();client.clear();vi.unstubAllGlobals();});
const mount=()=>render(<QueryClientProvider client={client}><ChatSheet open onOpenChange={vi.fn()} /></QueryClientProvider>);
describe('group chat creation and messaging',()=>{
  it('creates a group from the plus menu, selects colleagues and sends to that group',async()=>{
    const user=userEvent.setup();mount();
    await user.click(screen.getByRole('button',{name:'New chat'}));
    await user.click(screen.getByRole('menuitem',{name:'Create group'}));
    await user.type(screen.getByLabelText('Group name'),'Teachers');
    await user.click(await screen.findByRole('checkbox',{name:'Alice'}));
    await user.click(screen.getByRole('checkbox',{name:'Bob'}));
    expect(screen.queryByRole('checkbox',{name:'Me'})).toBeNull();
    await user.click(screen.getByRole('button',{name:'Create group'}));
    await screen.findByRole('heading',{name:'Teachers'});
    expect(mocks.api).toHaveBeenCalledWith('POST','/api/chat-groups',{name:'Teachers',participantIds:[2,3]});
    await user.type(screen.getByPlaceholderText('Type a message...'),'Hello team');
    await user.click(screen.getByRole('button',{name:'Send'}));
    await screen.findByText('Hello team');
    expect(mocks.api).toHaveBeenCalledWith('POST','/api/chat-groups/10/messages',{content:'Hello team'});
    await waitFor(()=>expect(mocks.api).toHaveBeenCalledWith('PUT','/api/chat-groups/10/read',{messageId:20}));
  });
  it('offers a personal chat in the same menu and opens the selected colleague',async()=>{
    const user=userEvent.setup();mount();
    await user.click(screen.getByRole('button',{name:'New chat'}));
    await user.click(screen.getByRole('menuitem',{name:'New direct chat'}));
    await user.click(await screen.findByRole('button',{name:'Alice'}));
    await screen.findByPlaceholderText('Type a message...');
    expect(mocks.api.mock.calls.some(([method,path])=>method==='POST'&&path==='/api/chat-groups')).toBe(false);
  });
});
