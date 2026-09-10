// PlantLens UNO Q read-only acquisition sketch.
//
// IMPORTANT: A0/A1/A2 are deliberately published as uncalibrated ADC counts.
// Do not connect industrial voltage/current directly to the UNO Q. Use certified,
// isolated signal conditioners matched to the actual sensor datasheets.

#include <Arduino_RouterBridge.h>

static constexpr unsigned long SAMPLE_INTERVAL_MS = 50;  // 20 Hz
static constexpr unsigned long DESCRIPTOR_INTERVAL_MS = 5000;

unsigned long previousSampleMs = 0;
unsigned long previousDescriptorMs = 0;
uint32_t sequenceNumber = 0;

void publishDescriptor() {
  // A periodic, broadcast-only descriptor permits discovery without probe bytes.
  Bridge.notify("plantlens_descriptor", "PLANTLENS/1", "UNO-Q", "pl-fw-0.1.0", 3, 20);
}

void setup() {
  Bridge.begin();
  pinMode(A0, INPUT);
  pinMode(A1, INPUT);
  pinMode(A2, INPUT);
  publishDescriptor();
}

void loop() {
  const unsigned long now = millis();

  if (now - previousSampleMs >= SAMPLE_INTERVAL_MS) {
    previousSampleMs = now;
    const int sensor1 = analogRead(A0);
    const int sensor2 = analogRead(A1);
    const int sensor3 = analogRead(A2);

    // There are intentionally no mutating Bridge.provide handlers in this firmware.
    Bridge.notify(
      "plantlens_sample",
      sequenceNumber++,
      static_cast<uint32_t>(now),
      sensor1,
      sensor2,
      sensor3
    );
  }

  if (now - previousDescriptorMs >= DESCRIPTOR_INTERVAL_MS) {
    previousDescriptorMs = now;
    publishDescriptor();
  }
}

