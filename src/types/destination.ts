export type DestinationKind = "cloud" | "local";

export interface Destination {
  kind: DestinationKind;
  label: string;
}
