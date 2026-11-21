// Drain the OS-provided .flow file queue. A failure opening one file must not
// strand the files behind it: report that file and keep going.
export async function drainFlowFiles({
  nextFlowFile,
  openFlowFile,
  onOpened,
  notify,
  isDisposed = () => false,
}) {
  const report = (error) => notify(error?.message ?? String(error));
  try {
    let file;
    while (!isDisposed() && (file = await nextFlowFile())) {
      try {
        const result = await openFlowFile(file);
        if (!isDisposed() && result) {
          onOpened(result);
        }
      } catch (error) {
        report(error);
      }
    }
  } catch (error) {
    // A failure reading the queue itself is fatal for this drain, but a later
    // OS event can start a fresh one.
    report(error);
  }
}
