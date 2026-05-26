import { BODY_TYPE_INFO } from "./bodyTypeInfo.js";
import { BODY_TYPES, type BodyType } from "./types.js";

export type BodyTypeOption = {
  value: BodyType;
  label: string;
};

export function listBodyTypeOptions(): BodyTypeOption[] {
  return BODY_TYPES.map((bodyType) => ({
    value: bodyType,
    label: BODY_TYPE_INFO[bodyType].displayName,
  }));
}
