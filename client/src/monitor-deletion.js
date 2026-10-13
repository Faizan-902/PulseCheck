export async function deleteMonitorAndReconcile({ id, knownMonitorIds, deleteRequest, listRequest }) {
  try {
    await deleteRequest(id);
  } catch (deleteError) {
    if (deleteError.status !== 404) throw deleteError;

    let monitors;
    try {
      monitors = await listRequest();
    } catch (refreshError) {
      return { status: 'unverified', monitors: null, deleteError, refreshError };
    }

    const wasKnownToCurrentUser = knownMonitorIds.includes(id);
    const stillListed = monitors.some((monitor) => monitor.id === id);
    if (wasKnownToCurrentUser && !stillListed) {
      return { status: 'already-absent', monitors, deleteError };
    }
    return { status: 'not-found', monitors, deleteError };
  }

  try {
    return { status: 'deleted', monitors: await listRequest() };
  } catch (refreshError) {
    return { status: 'deleted', monitors: null, refreshError };
  }
}
