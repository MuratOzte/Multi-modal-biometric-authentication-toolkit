import { useFixedTextKeystrokePlaygroundController } from "./FixedTextKeystrokePlayground.controller.js";
import { FixedTextKeystrokePlaygroundView } from "./FixedTextKeystrokePlayground.view.js";

export const FixedTextKeystrokePlayground = () => {
  const model = useFixedTextKeystrokePlaygroundController();
  return <FixedTextKeystrokePlaygroundView {...model} />;
};
