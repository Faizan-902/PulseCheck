import { describe, expect, it, vi } from 'vitest';
import { deleteMonitorAndReconcile } from '../../client/src/monitor-deletion.js';

const monitorId = '8dddbef2-67e0-4cc8-93e5-00fac552af29';
const otherMonitorId = 'b05cc8f8-5882-4aa2-8b96-091b9fd98d09';
const notFound = () => Object.assign(new Error('The endpoint was not found.'), { status: 404 });

describe('monitor deletion reconciliation', () => {
  it('uses the refreshed monitor list after the API confirms deletion', async () => {
    const deleteRequest = vi.fn().mockResolvedValue(undefined);
    const listRequest = vi.fn().mockResolvedValue([{ id: otherMonitorId }]);

    await expect(deleteMonitorAndReconcile({
      id: monitorId,
      knownMonitorIds: [monitorId],
      deleteRequest,
      listRequest
    })).resolves.toEqual({ status: 'deleted', monitors: [{ id: otherMonitorId }] });

    expect(deleteRequest).toHaveBeenCalledWith(monitorId);
    expect(listRequest).toHaveBeenCalledOnce();
  });

  it('treats a repeated deletion as already absent only after an authoritative list confirms absence', async () => {
    const listRequest = vi.fn().mockResolvedValue([{ id: otherMonitorId }]);
    const result = await deleteMonitorAndReconcile({
      id: monitorId,
      knownMonitorIds: [monitorId],
      deleteRequest: vi.fn().mockRejectedValue(notFound()),
      listRequest
    });

    expect(result).toMatchObject({ status: 'already-absent', monitors: [{ id: otherMonitorId }] });
    expect(listRequest).toHaveBeenCalledOnce();
  });

  it('does not treat an unknown or cross-user ID as a successful deletion', async () => {
    const result = await deleteMonitorAndReconcile({
      id: monitorId,
      knownMonitorIds: [otherMonitorId],
      deleteRequest: vi.fn().mockRejectedValue(notFound()),
      listRequest: vi.fn().mockResolvedValue([{ id: otherMonitorId }])
    });

    expect(result.status).toBe('not-found');
    expect(result.monitors).toEqual([{ id: otherMonitorId }]);
  });

  it('does not infer success from a stale ID that was never in the current owned list', async () => {
    const result = await deleteMonitorAndReconcile({
      id: monitorId,
      knownMonitorIds: [],
      deleteRequest: vi.fn().mockRejectedValue(notFound()),
      listRequest: vi.fn().mockResolvedValue([])
    });

    expect(result.status).toBe('not-found');
  });

  it('does not report success when a 404 refresh still lists the monitor', async () => {
    const result = await deleteMonitorAndReconcile({
      id: monitorId,
      knownMonitorIds: [monitorId],
      deleteRequest: vi.fn().mockRejectedValue(notFound()),
      listRequest: vi.fn().mockResolvedValue([{ id: monitorId }])
    });

    expect(result.status).toBe('not-found');
  });

  it('leaves deletion unverified when the authoritative refresh fails', async () => {
    const result = await deleteMonitorAndReconcile({
      id: monitorId,
      knownMonitorIds: [monitorId],
      deleteRequest: vi.fn().mockRejectedValue(notFound()),
      listRequest: vi.fn().mockRejectedValue(new Error('List unavailable'))
    });

    expect(result).toMatchObject({ status: 'unverified', refreshError: expect.objectContaining({ message: 'List unavailable' }) });
  });
});
