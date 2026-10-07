import React from "react";
import { CardVerificationTester } from "./components/CardVerificationTester.js";
import { FaceVerificationTester } from "./components/FaceVerificationTester.js";
import { FixedTextKeystrokePlayground } from "./components/FixedTextKeystrokePlayground.js";
import { VoiceVerificationTester } from "./components/VoiceVerificationTester.js";

function App() {
  return (
    <div style={{ padding: 12 }}>
      <CardVerificationTester />
      <FaceVerificationTester />
      <VoiceVerificationTester />
      <FixedTextKeystrokePlayground />
    </div>
  );
}

export default App;
