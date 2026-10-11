// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalDeliveryFailuresDialog, PortalDeliveryFailuresButton } from "../client/src/features/portal-access/PortalDeliveryFailuresDialog";
import { PortalDeliveryRequestError } from "../client/src/features/portal-access/delivery-api";
import { i18n } from "../client/src/lib/i18n";
import type { PortalDeliveryFailure } from "@shared/contracts/portal-delivery-management";
const mocks = vi.hoisted(()=>({ user:{id:7,module:"administration",modules:["administration"]},list:vi.fn(),retry:vi.fn() }));
vi.mock("../client/src/hooks/useAuth",()=>({useAuth:()=>({user:mocks.user})}));
vi.mock("../client/src/features/portal-access/delivery-api",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("../client/src/features/portal-access/delivery-api")>();
  return {...actual,portalDeliveryApi:{list:mocks.list,retry:mocks.retry}};
});
class ResizeObserverStub{observe(){}unobserve(){}disconnect(){}}
(globalThis as unknown as {ResizeObserver:unknown}).ResizeObserver=ResizeObserverStub;
(Element.prototype as unknown as Record<string,unknown>).hasPointerCapture=()=>false;
(Element.prototype as unknown as Record<string,unknown>).setPointerCapture=()=>undefined;
(Element.prototype as unknown as Record<string,unknown>).releasePointerCapture=()=>undefined;
(Element.prototype as unknown as Record<string,unknown>).scrollIntoView=()=>undefined;
let rows:PortalDeliveryFailure[];
const wrapper=(element:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{element}</QueryClientProvider>);
const show=(props:Partial<React.ComponentProps<typeof PortalDeliveryFailuresDialog>>={})=>wrapper(<PortalDeliveryFailuresDialog open onOpenChange={()=>undefined} {...props}/>);
beforeEach(()=>{
  i18n.setLanguage("en");vi.clearAllMocks();mocks.user={id:7,module:"administration",modules:["administration"]};
  rows=[{id:5,kind:"resource",account:{id:9,login:"parent.login",fullName:"Parent"},recipient:"parent@example.invalid",template:"notification",createdAt:"2026-10-11T12:00:00Z",reason:"delivery_failed",canRetry:true,version:"a".repeat(64)},
    {id:6,kind:"identity",account:{id:10,login:"expired.login",fullName:"Expired"},recipient:"expired@example.invalid",template:"invitation",createdAt:"2026-10-11T11:00:00Z",reason:"delivery_interrupted",canRetry:false,version:"b".repeat(64)}];
  mocks.list.mockImplementation(async(query)=>({items:query.cursor?[]:rows.filter(row=>query.kind==="all"||row.kind===query.kind),hasMore:!query.cursor&&query.kind==="all",nextCursor:!query.cursor&&query.kind==="all"?"page-two":null}));
  mocks.retry.mockImplementation(async(kind,id)=>{rows=rows.filter(row=>row.kind!==kind||row.id!==id);return{queued:true,replayed:false};});
});
afterEach(cleanup);
describe("Administrative delivery failure modal",()=>{
  it("opens a dedicated modal with paged rows and disables unavailable deliveries",async()=>{
    wrapper(<PortalDeliveryFailuresButton/>);expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Delivery failures"}));
    expect(await screen.findByRole("dialog",{name:"Delivery failures"})).toBeTruthy();
    expect(await screen.findByText("parent@example.invalid")).toBeTruthy();
    expect(screen.getByText("Delivery retry is unavailable")).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Retry delivery: Expired"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Next"}));
    await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({kind:"all",cursor:"page-two",limit:30}));
    expect(await screen.findByText("No delivery failures")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Previous"}));expect(await screen.findByText("parent@example.invalid")).toBeTruthy();
  });
  it("sends a CAS version and UUID once then refreshes the failed list",async()=>{
    show();fireEvent.click(await screen.findByRole("button",{name:"Retry delivery: Parent"}));
    await waitFor(()=>expect(mocks.retry).toHaveBeenCalledTimes(1));
    const [kind,id,input]=mocks.retry.mock.calls[0];expect(kind).toBe("resource");expect(id).toBe(5);expect(input.version).toBe("a".repeat(64));expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Delivery retry queued")).toBeTruthy();await waitFor(()=>expect(screen.queryByText("parent@example.invalid")).toBeNull());
  });
  it("keeps the same retry key after an uncertain response and never shows raw server errors",async()=>{
    mocks.retry.mockRejectedValueOnce(new Error("secret@example.invalid internal database connection"));
    show();fireEvent.click(await screen.findByRole("button",{name:"Retry delivery: Parent"}));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","Could not load messages");expect(screen.queryByText(/internal database/)).toBeNull();
    const first=mocks.retry.mock.calls[0][2];fireEvent.click(screen.getByRole("button",{name:"Retry delivery: Parent"}));
    await waitFor(()=>expect(mocks.retry).toHaveBeenCalledTimes(2));expect(mocks.retry.mock.calls[1][2]).toEqual(first);expect(await screen.findByText("Delivery retry queued")).toBeTruthy();
  });
  it("shows a changed-state error and filters by message family",async()=>{
    mocks.retry.mockRejectedValueOnce(new PortalDeliveryRequestError("portalDeliveryConflict"));
    show();fireEvent.click(await screen.findByRole("button",{name:"Retry delivery: Parent"}));
    expect(await screen.findByText("Delivery status changed. Refresh the list.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Message"),{target:{value:"identity"}});
    await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith({kind:"identity",cursor:undefined,limit:30}));
    expect(await screen.findByText("expired@example.invalid")).toBeTruthy();expect(screen.queryByText("parent@example.invalid")).toBeNull();
  });
  it("does not query for teachers, finance staff or disabled administration access",()=>{
    mocks.user={id:7,module:"teacher",modules:["teacher"]};const teacher=show();expect(screen.queryByRole("dialog")).toBeNull();teacher.unmount();
    mocks.user={id:7,module:"finance",modules:["finance"]};const finance=show();expect(screen.queryByRole("dialog")).toBeNull();finance.unmount();
    mocks.user={id:7,module:"administration",modules:["administration"]};show({canManageAccess:false});expect(mocks.list).not.toHaveBeenCalled();
  });
  it("preserves a recoverable error state when the failure list cannot be fetched",async()=>{
    mocks.list.mockRejectedValueOnce(new Error("private server details"));show();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","Could not load messages");expect(screen.queryByText("private server details")).toBeNull();
    fireEvent.click(screen.getAllByRole("button",{name:"Try again"})[0]);expect(await screen.findByText("parent@example.invalid")).toBeTruthy();
  });
});
