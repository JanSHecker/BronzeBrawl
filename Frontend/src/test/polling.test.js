import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePolling } from "../useRequest";

afterEach(() => vi.useRealTimers());

test("polling releases failures, never overlaps, and aborts on unmount", async () => {
  vi.useFakeTimers();
  let finish;
  let signal;
  const work = vi.fn().mockRejectedValueOnce(new Error("temporary failure"))
    .mockImplementationOnce(currentSignal => { signal = currentSignal; return new Promise(resolve => { finish = resolve; }); });
  const { result, unmount } = renderHook(() => usePolling(work));
  await act(async () => {});
  expect(result.current.error).not.toBe("");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(work).toHaveBeenCalledTimes(2);
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(work).toHaveBeenCalledTimes(2);
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(work).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test("post-mutation refresh waits for an older poll and then fetches canonical state", async () => {
  vi.useFakeTimers();
  let finish;
  const work = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() => usePolling(work));
  expect(work).toHaveBeenCalledTimes(1);
  await act(async () => {
    const refreshing = result.current.refresh();
    expect(work).toHaveBeenCalledTimes(1);
    finish();
    await refreshing;
  });
  expect(work).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
