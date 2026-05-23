import type { BodyType } from "./types.js";

export type BodyTypeInfo = {
  displayName: string;
  description: string;
  gender: "female" | "male" | "both";
  family: "cbbe" | "unp" | "male" | "addon" | "vanilla";
  topology: "cbbe" | "unp" | "male" | "legacy-female" | "vanilla";
  physicsSupport: boolean;
  referenceProject: string;
  physicsBones: string[];
  adaptationFocus: string[];
  conversionNotes: string;
};

export const BODY_TYPE_INFO: Record<BodyType, BodyTypeInfo> = {
  cbbe: {
    displayName: "CBBE – Caliente's Beautiful Bodies Enhancer",
    description:
      "Most widely used female body for Skyrim. Provides shape presets (Curvy, Slim, etc.) via BodySlide. Base mesh for the majority of female armor/clothing conversions.",
    gender: "female",
    family: "cbbe",
    topology: "cbbe",
    physicsSupport: false,
    referenceProject: "CalienteTools / BodySlide by Caliente & ousnius",
    physicsBones: [],
    adaptationFocus: ["bust", "waist", "hips", "wrist seams", "ankle seams"],
    conversionNotes:
      "CBBE is the reference baseline for most conversion workflows. Converting FROM other bodies TO CBBE: project morphs onto the CBBE reference mesh, rebuild OSP slider sets, verify neck/wrist/ankle seams.",
  },
  "3ba": {
    displayName: "3BA – 3BBB Amazing Body",
    description:
      "CBBE-based female body with physics-enabled breasts, butt, and belly. Requires CBPC or HDT-SMP. Adds physics chain bones on top of the standard CBBE skeleton.",
    gender: "female",
    family: "cbbe",
    topology: "cbbe",
    physicsSupport: true,
    referenceProject: "3BA / 3BBB Amazing Body by acro748",
    physicsBones: [
      "NPC L Breast01",
      "NPC R Breast01",
      "NPC L Breast02",
      "NPC R Breast02",
      "NPC L Breast03",
      "NPC R Breast03",
      "NPC LBreastRoot",
      "NPC RBreastRoot",
      "NPC L Butt",
      "NPC R Butt",
    ],
    adaptationFocus: [
      "breast volume",
      "butt volume",
      "belly weighting",
      "physics groups",
    ],
    conversionNotes:
      "Converting TO 3BA: add physics-chain bone weighting to breast and butt areas; CBPC config must list those bones. Converting FROM 3BA to a non-physics body: collapse all physics-chain bone weights back to NPC Spine2 and NPC Pelvis.",
  },
  himbo: {
    displayName: "HIMBO – Highly Improved Male Body Overhaul",
    description:
      "Leading male body replacer with extensive BodySlide support and a full slider set. Uses a different bone hierarchy and proportions from all female bodies.",
    gender: "male",
    family: "male",
    topology: "male",
    physicsSupport: false,
    referenceProject: "HIMBO by Tiktak123",
    physicsBones: [],
    adaptationFocus: [
      "shoulders",
      "pectorals",
      "upper arms",
      "waist taper",
      "pelvis width",
    ],
    conversionNotes:
      "Converting female armor to HIMBO requires significant mesh projection because shoulder, chest, and pelvis proportions differ substantially. Expect manual cleanup in Outfit Studio.",
  },
  bodytalk: {
    displayName: "BodyTalk – Male Body Replacer",
    description:
      "Popular male body replacer family predating HIMBO, often distributed as BodyTalk V2/V3 with high-poly male meshes and slider presets.",
    gender: "male",
    family: "male",
    topology: "male",
    physicsSupport: false,
    referenceProject:
      "BodyTalk by Haeun / Bad Dog / assorted community maintainers",
    physicsBones: [],
    adaptationFocus: [
      "shoulders",
      "chest depth",
      "abdomen definition",
      "thigh mass",
    ],
    conversionNotes:
      "BodyTalk projects behave similarly to other male slider sets but often keep distinct naming. Converting to or from BodyTalk should preserve male asset paths while retargeting BodySlide metadata to BodyTalk aliases.",
  },
  tbd: {
    displayName: "TBD – Touched by Dibella",
    description:
      "Alternative female body replacer focused on larger proportions and a different silhouette. Compatible with BodySlide slider sets.",
    gender: "female",
    family: "cbbe",
    topology: "cbbe",
    physicsSupport: false,
    referenceProject: "TBD / Touched by Dibella by Maars",
    physicsBones: [],
    adaptationFocus: ["bust projection", "hip volume", "waist curve"],
    conversionNotes:
      "TBD proportions differ notably from CBBE. Projection requires a lower weight threshold to avoid clipping at the bust and hip areas.",
  },
  sos: {
    displayName: "SOS – Schlongs of Skyrim",
    description:
      "Male genital addon for Skyrim that adds a physics-ready genital mesh and skeleton extension. Often used alongside SAM or HIMBO.",
    gender: "male",
    family: "addon",
    topology: "male",
    physicsSupport: false,
    referenceProject: "Schlongs of Skyrim by b3lisario",
    physicsBones: [
      "NPC GenitalsBase01",
      "NPC GenitalsBase02",
      "NPC GenitalsBase03",
      "NPC GenitalsBase04",
      "NPC GenitalsBase05",
      "NPC L GenitalsScrotum01",
      "NPC R GenitalsScrotum01",
    ],
    adaptationFocus: ["pelvis seam", "waistband partition", "SBP 52 slot"],
    conversionNotes:
      "Pelvis partition and seam vertices around the waistband must be preserved exactly when converting armors to SOS compatibility. Always verify the partition slot (SBP 52) is clean.",
  },
  unp: {
    displayName: "UNP – Dimonized UNP Female Body",
    description:
      "Classic female body replacer with a slimmer proportioned mesh than CBBE. Many legacy mods still target UNP topology.",
    gender: "female",
    family: "unp",
    topology: "unp",
    physicsSupport: false,
    referenceProject: "Dimonized UNP by dimon99",
    physicsBones: [],
    adaptationFocus: ["waist", "hips", "thighs", "leg seams"],
    conversionNotes:
      "UNP has different topology from CBBE; mesh projection is required. Seam edge loops at neck, wrist, and ankle differ from CBBE so pay extra attention to those areas.",
  },
  bhunp: {
    displayName: "BHUNP – BoneHunger UNP",
    description:
      "UNP variant with CBPC/HDT-SMP physics support. Adds breast and butt physics chains to the UNP skeleton. Compatible with BodySlide.",
    gender: "female",
    family: "unp",
    topology: "unp",
    physicsSupport: true,
    referenceProject: "BHUNP by BoneHunger",
    physicsBones: [
      "BHUNP Breast L01",
      "BHUNP Breast R01",
      "BHUNP Breast L02",
      "BHUNP Breast R02",
      "BHUNP Butt L",
      "BHUNP Butt R",
    ],
    adaptationFocus: [
      "breast weighting",
      "butt weighting",
      "physics groups",
      "waist seams",
    ],
    conversionNotes:
      "Similar conversion path to 3BA but uses different physics bone names. Confirm CBPC config file references BHUNP bone names specifically, not 3BA bone names.",
  },
  uunp: {
    displayName: "UUNP – Unified UNP",
    description:
      "BodySlide-compatible unified version of UNP supporting multiple shape presets, mirroring CBBE's slider-based workflow.",
    gender: "female",
    family: "unp",
    topology: "unp",
    physicsSupport: false,
    referenceProject: "UUNP by ousnius",
    physicsBones: [],
    adaptationFocus: ["slider compatibility", "waist", "hip curve"],
    conversionNotes:
      "Shares topology with UNP but optimised for BodySlide. Project onto UUNP BodySlide reference body and rebuild OSP slider sets.",
  },
  "7base": {
    displayName: "7base – SevenBase Female Body",
    description:
      "Older alternative female body with a heavily stylised silhouette. Mainly found in legacy conversions.",
    gender: "female",
    family: "unp",
    topology: "legacy-female",
    physicsSupport: false,
    referenceProject: "SevenBase by Crosscrusade",
    physicsBones: [],
    adaptationFocus: ["stylised hips", "thigh mass", "legacy seam cleanup"],
    conversionNotes:
      "Topology differs from both CBBE and UNP. Manual vertex projection in Outfit Studio is recommended due to significantly different body proportions.",
  },
  sam: {
    displayName: "SAM – Shape Atlas for Men",
    description:
      "Advanced male body replacer with BodyMorph support for weight and muscle shape variation. SAM Light adds BodySlide integration.",
    gender: "male",
    family: "male",
    topology: "male",
    physicsSupport: false,
    referenceProject: "SAM by Vector / SAM Light by KouLeifoh",
    physicsBones: [],
    adaptationFocus: [
      "muscle sliders",
      "chest width",
      "waist taper",
      "thigh mass",
    ],
    conversionNotes:
      "Converting female armors to SAM requires full cross-gender mesh projection. Use SAM Light + BodySlide for slider-based output. Chest and waist proportions differ from HIMBO.",
  },
  vanilla: {
    displayName: "Vanilla – Default Game Body",
    description:
      "The unmodified base game body mesh. Mods targeting vanilla will work without any body replacer installed.",
    gender: "both",
    family: "vanilla",
    topology: "vanilla",
    physicsSupport: false,
    referenceProject: "Bethesda Softworks",
    physicsBones: [],
    adaptationFocus: [
      "base-game seams",
      "default partitions",
      "weight slider range",
    ],
    conversionNotes:
      "Converting FROM vanilla means the mod was built for the base game. Converting TO vanilla is uncommon but may be required for maximum compatibility patches.",
  },
};
