import { useSecureKitPlaygroundController } from "./SecureKitPlayground.controller.js";
import { SecureKitPlaygroundView } from "./SecureKitPlayground.view.js";

export const SecureKitPlayground = () => {
  const model = useSecureKitPlaygroundController();
  return <SecureKitPlaygroundView {...model} />;
};
