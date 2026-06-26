/**
 * The laboratory root. Everything interesting lives in {@link LabView}; this is
 * just the mount point.
 */
import { LabView } from "./topology/LabView.js";

export function App(): JSX.Element {
  return <LabView />;
}
