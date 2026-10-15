export async function withTelephonyRequestDeadline<Value>(request: Promise<Value>): Promise<Value> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error('onlinePbxUnavailable')), 15_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
