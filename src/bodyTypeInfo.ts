import type { BodyType } from "./types.js";

export type BodyTypeInfo = {
  displayName: string;
  description: string;
  gender: "female" | "male" | "both";
  family: "cbbe" | "unp" | "male" | "addon" | "vanilla";
  topology: "cbbe" | "unp" | "male" | "legacy-female" | "vanilla";
  physicsSupport: boolean;
  skeletonProfile: string;
  skeletonNotes: string;
  referenceProject: string;
  aliases: string[];
  commonVariants: string[];
  physicsBones: string[];
  adaptationFocus: string[];
  conversionNotes: string;
};

export const BODY_TYPE_INFO: Record<BodyType, BodyTypeInfo> = {
  cbbe: {
    displayName: "CBBE – Caliente's Beautiful Bodies Enhancer",
    description:
      "Most widely used female body for Skyrim SE/AE. Provides shape presets (Curvy, Slim, etc.) via BodySlide. Base static mesh that the majority of female armor/clothing conversions target. Physics variants (CBBE SMP, 3BA) are separate body mods that build on the CBBE skeleton.",
    gender: "female",
    family: "cbbe",
    topology: "cbbe",
    physicsSupport: false,
    skeletonProfile: "Vanilla female-compatible (XPMSSE recommended)",
    skeletonNotes:
      "Base CBBE can run on the vanilla female skeleton, but XPMSSE (XP32 Maximum Skeleton Special Extended) is the Skyrim SE/AE compatibility standard for mixed BodySlide setups.",
    referenceProject: "CalienteTools / BodySlide by Caliente & ousnius",
    aliases: [
      "CBBE",
      "CBBE SE",
      "CBBE AE",
      "CBBE LE",
      "Caliente's Beautiful Bodies Enhancer",
      "Caliente's Beautiful Bodies",
      "Caliente Beautiful Bodies",
    ],
    commonVariants: [
      "CBBE Curvy",
      "CBBE Slim",
      "CBBE Vanilla",
      "CBBE NeverNude",
      "CBBE NeverNude AE",
      "CBBE Body Special",
    ],
    physicsBones: [],
    adaptationFocus: ["bust", "waist", "hips", "wrist seams", "ankle seams"],
    conversionNotes:
      "CBBE is the reference baseline for most conversion workflows. Converting FROM other bodies TO CBBE: project morphs onto the CBBE reference mesh, rebuild OSP slider sets, verify neck/wrist/ankle seams. Base CBBE has no physics; physics-enabled variants (3BA/CBBE SMP) require additional physics bone weighting.",
  },
  "3ba": {
    displayName: "3BA – 3BBB Amazing Body",
    description:
      "CBBE-based female body with full physics for breasts, butt, and belly. Requires CBPC or HDT-SMP. Extends the CBBE skeleton with BreastRoot control bones and a belly physics chain on top of the standard NPC breast/butt bones. The most widely used physics body for Skyrim SE/AE as of 2024.",
    gender: "female",
    family: "cbbe",
    topology: "cbbe",
    physicsSupport: true,
    skeletonProfile: "XPMSSE / XP32 Extended required",
    skeletonNotes:
      "3BA expects XPMSSE-style extended breast/butt/belly chains (including L/R BreastRoot). Using a non-XP32 skeleton usually breaks runtime physics behavior.",
    referenceProject: "3BA / 3BBB Amazing Body by acro748",
    aliases: [
      "3BA",
      "3BBB",
      "CBBE 3BA",
      "CBBE 3BBB",
      "Acro's 3BA",
      "Acro's 3BBB",
      "3BA AE",
      "CBBE 3BA AE",
    ],
    commonVariants: [
      "3BBB Amazing",
      "3BBB Amazing Body",
      "CBBE SMP",
      "3BBB Physics",
      "CBBE Physics",
      "CBBE 3BA Physics",
      "3BA Body Amazing",
      "3BBB Advanced",
      "3BA Advanced",
    ],
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
      "NPC Belly",
      "NPC BellyRoot",
    ],
    adaptationFocus: [
      "breast volume",
      "BreastRoot chain",
      "butt volume",
      "belly weighting",
      "physics groups",
    ],
    conversionNotes:
      "Converting TO 3BA: add physics-chain bone weighting to breast and butt areas; CBPC config must list those bones. NPC LBreastRoot / NPC RBreastRoot are 3BA-specific root control bones above the standard chain. Converting FROM 3BA to a non-physics body: collapse all physics-chain bone weights back to NPC Spine2 (breast) and NPC Pelvis (butt). NPC BellyRoot collapses to NPC Belly for non-3BA targets.",
  },
  himbo: {
    displayName: "HIMBO – Highly Improved Male Body Overhaul",
    description:
      "Leading male body replacer for Skyrim SE/AE with extensive BodySlide support and a full slider set. Uses a different bone hierarchy and proportions from all female bodies — wider shoulders, deeper chest, and narrower hips. HIMBO V5+ supports optional physics via the HIMBO Physics Addon (HDT-SMP), which uses NPC L/R Pectoral bones. Compatible with most male armor conversions.",
    gender: "male",
    family: "male",
    topology: "male",
    physicsSupport: false,
    skeletonProfile: "XPMSSE male skeleton recommended",
    skeletonNotes:
      "HIMBO armor conversion is most reliable with XPMSSE-compatible male skeleton paths and modern animation behavior packs. The optional HIMBO Physics Addon requires XPMSSE with pectoral node support.",
    referenceProject: "HIMBO by Tiktak123 (V5+)",
    aliases: [
      "HIMBO",
      "HIMBO SE",
      "HIMBO AE",
      "HIMBO V5",
      "HIMBO V5+",
      "Highly Improved Male Body Overhaul",
      "High Poly Male Body",
    ],
    commonVariants: [
      "HIMBO Beefy",
      "HIMBO Slim",
      "HIMBO Average",
      "HIMBO V4",
      "HIMBO V5",
      "HIMBO Physics Addon",
      "HIMBO Reduced",
    ],
    physicsBones: [],
    adaptationFocus: [
      "shoulders",
      "pectorals",
      "upper arms",
      "waist taper",
      "pelvis width",
      "glutes",
      "calves",
    ],
    conversionNotes:
      "Converting female armor to HIMBO requires significant mesh projection because shoulder, chest, and pelvis proportions differ substantially. Prioritize BodySlide preview and in-game checks for chest and shoulder fit extremes. For HIMBO V5+ physics, the optional HIMBO Physics Addon uses HDT-SMP with NPC L/R Pectoral bones; enable that separately after the BodySlide conversion.",
  },
  bodytalk: {
    displayName: "BodyTalk – High-Poly Male Body Replacer",
    description:
      "Popular high-poly male body replacer family (BodyTalk V2/V3 / BT3) with BodySlide slider presets. Predates HIMBO. Older in style but widely referenced in legacy male conversions. BT3 (BodyTalk V3) is the most used modern variant and includes a BodyTalk Physics variant (HDT-SMP).",
    gender: "male",
    family: "male",
    topology: "male",
    physicsSupport: false,
    skeletonProfile: "XPMSSE male skeleton recommended",
    skeletonNotes:
      "BodyTalk packs generally assume XP32/XPMSSE-era skeleton layouts in Skyrim SE ports, especially when mixed with modern animation and physics mods.",
    referenceProject:
      "BodyTalk by Haeun / Bad Dog / assorted community maintainers",
    aliases: [
      "BodyTalk",
      "BodyTalk 3",
      "BodyTalk V3",
      "BodyTalk SE",
      "BT3",
      "BodyTalk V2",
      "BT2",
    ],
    commonVariants: [
      "BT2",
      "BT3 Muscle Solution",
      "BodyTalk Physics",
      "BodyTalk V3 SE",
    ],
    physicsBones: [],
    adaptationFocus: [
      "shoulders",
      "chest depth",
      "abdomen definition",
      "thigh mass",
    ],
    conversionNotes:
      "BodyTalk projects behave similarly to other male slider sets but keep distinct naming. Converting to or from BodyTalk should preserve male asset paths while retargeting BodySlide metadata to BodyTalk aliases. BT3 (BodyTalk V3) is the most common modern variant.",
  },
  tbd: {
    displayName: "TBD – Touched by Dibella",
    description:
      "Alternative female body replacer by Maars focused on larger proportions and a distinct CBBE-compatible silhouette. TBD uses CBBE topology and the same skeleton, so it is directly compatible with standard CBBE/CBPC physics bone configs (NPC breast/butt bones). Requires a physics addon (CBPC or HDT-SMP) to activate breast/butt/belly motion. TBD 3BBB adds full belly physics support.",
    gender: "female",
    family: "cbbe",
    topology: "cbbe",
    physicsSupport: true,
    skeletonProfile: "XPMSSE / XP32-compatible skeleton recommended",
    skeletonNotes:
      "TBD uses CBBE-family physics naming and is typically deployed on XPMSSE in Skyrim SE modlists to keep CBPC/HDT-SMP behavior consistent.",
    referenceProject: "TBD / Touched by Dibella by Maars",
    aliases: [
      "TBD",
      "TBD Body",
      "Touched by Dibella",
      "Touched by Dibella SE",
      "TBD SE",
    ],
    commonVariants: [
      "TBD 3BBB",
      "TBD SMP",
      "TBD HDT",
      "TBD Special",
      "TBD Physics",
      "Touched by Dibella Physics",
      "TBD CBBE Physics",
    ],
    physicsBones: [
      "NPC L Breast01",
      "NPC R Breast01",
      "NPC L Breast02",
      "NPC R Breast02",
      "NPC L Breast03",
      "NPC R Breast03",
      "NPC L Butt",
      "NPC R Butt",
      "NPC Belly",
    ],
    adaptationFocus: [
      "bust projection",
      "hip volume",
      "waist curve",
      "physics groups",
    ],
    conversionNotes:
      "TBD proportions differ notably from standard CBBE — larger bust and hip volume. When projecting TO TBD, lower the projection threshold slightly to avoid clipping at bust and hip extremes. TBD uses the same physics bone names as CBBE (NPC L/R Breast01-03, L/R Butt, NPC Belly) without the 3BA-specific BreastRoot bones; physics configs are interchangeable with CBBE-family physics setups.",
  },
  sos: {
    displayName: "SOS – Schlongs of Skyrim",
    description:
      "Male genital addon for Skyrim that adds a physics-ready genital mesh and skeleton extension. SOS Regular uses HDT-SMP physics for the genital mesh; SOS Light is the static (no-physics) variant. Often used alongside SAM, HIMBO, or BodyTalk. Maintained by the community for SE/AE as SOS SE.",
    gender: "male",
    family: "addon",
    topology: "male",
    physicsSupport: true,
    skeletonProfile: "XPMSSE + SOS-compatible skeleton nodes required",
    skeletonNotes:
      "SOS Regular relies on extended genital/scrotum nodes provided by XPMSSE-compatible skeleton setups; missing nodes prevent expected runtime motion. SOS AE (Anniversary Edition) uses the same node structure.",
    referenceProject: "Schlongs of Skyrim by b3lisario / community SE port",
    aliases: [
      "SOS",
      "SOS SE",
      "SOS Full",
      "SOS Light",
      "Schlongs of Skyrim",
      "SOS AE",
    ],
    commonVariants: [
      "SOS Regular",
      "SOS Full",
      "SOS Light",
      "SOS AE",
      "SOS Full SE",
      "SOS Regular SE",
    ],
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
      "Pelvis partition and seam vertices around the waistband must be preserved exactly when converting armors to SOS compatibility. Always verify the partition slot (SBP 52) is clean. SOS Regular requires HDT-SMP; ensure the corresponding SMP XML config is present. SOS Light skips physics entirely.",
  },
  unp: {
    displayName: "UNP – Dimonized UNP Female Body",
    description:
      "Classic female body replacer with a slimmer, more naturalistic proportioned mesh than CBBE. Many legacy Skyrim LE/SE mods still target UNP topology. Neck, wrist, and ankle seam edge loops differ from CBBE. UNP Female Body Renewed (UNPB) is the most common updated variant with improved UV mapping.",
    gender: "female",
    family: "unp",
    topology: "unp",
    physicsSupport: false,
    skeletonProfile: "Vanilla UNP-compatible (XPMSSE recommended)",
    skeletonNotes:
      "Legacy UNP conversions can run on vanilla-compatible female skeletons, but XPMSSE remains the common Skyrim SE baseline for mixed BodySlide ecosystems.",
    referenceProject:
      "Dimonized UNP by dimon99 / UNP Female Body Renewed by Goma Pero",
    aliases: [
      "UNP",
      "UNP Body",
      "Dimonized UNP",
      "UNP Blessed",
      "UNP Female Body Renewed",
      "UNPB",
      "UNPB Renewed",
    ],
    commonVariants: [
      "UNPB",
      "UNPC",
      "UNPS",
      "UNP Skinny",
      "UNPCM",
      "UNP Next Generation",
    ],
    physicsBones: [],
    adaptationFocus: ["waist", "hips", "thighs", "leg seams", "ankle seams"],
    conversionNotes:
      "UNP has different topology from CBBE; mesh projection is required. Seam edge loops at neck, wrist, and ankle differ from CBBE — pay extra attention to those areas when converting armors between families. UNP Female Body Renewed (UNPB) uses improved UV mapping and should be preferred over the original for new conversions.",
  },
  bhunp: {
    displayName: "BHUNP – BoneHunger UNP 3BBB",
    description:
      "UNP variant with full CBPC/HDT-SMP physics support. Adds three-level breast chains (L/R01–03), butt bones, and belly physics to the UNP skeleton using the BHUNP-prefixed bone naming convention. Compatible with BodySlide. BHUNP V3 introduced improved topology and additional sliders.",
    gender: "female",
    family: "unp",
    topology: "unp",
    physicsSupport: true,
    skeletonProfile: "XPMSSE / XP32 Extended required",
    skeletonNotes:
      "BHUNP physics chains are usually deployed through XPMSSE-compatible setups; confirm BHUNP-prefixed breast/butt node support before shipping.",
    referenceProject: "BHUNP by BoneHunger",
    aliases: [
      "BHUNP",
      "BHUNP SE",
      "BHUNP SSE",
      "BoneHunger UNP",
      "Baka Haeun UNP",
      "Bodyslide and HDT UNP",
      "BHUNP UNP Next Generation",
    ],
    commonVariants: [
      "BHUNP 3BBB",
      "BHUNP Vanilla",
      "BHUNP Physics",
      "BHUNP V3",
      "BHUNP 3BBB Advanced",
      "BHUNP Special Edition",
    ],
    physicsBones: [
      "BHUNP Breast L01",
      "BHUNP Breast R01",
      "BHUNP Breast L02",
      "BHUNP Breast R02",
      "BHUNP Breast L03",
      "BHUNP Breast R03",
      "BHUNP Butt L",
      "BHUNP Butt R",
      "NPC Belly",
    ],
    adaptationFocus: [
      "breast weighting",
      "butt weighting",
      "physics groups",
      "waist seams",
    ],
    conversionNotes:
      "Similar conversion path to 3BA but uses different physics bone names for breast chains (BHUNP Breast L/R01-03 vs NPC L/R Breast01-03) and butt bones (BHUNP Butt L/R vs NPC L/R Butt). Belly physics uses the shared NPC Belly bone. BHUNP does NOT use BreastRoot bones — those are 3BA-specific. Confirm CBPC config references BHUNP bone names specifically.",
  },
  uunp: {
    displayName: "UUNP – Unified UNP",
    description:
      "BodySlide-compatible unified version of UNP supporting multiple shape presets via a single slider set, mirroring CBBE's workflow. UUNP Special (the most common variant) includes TBBP (Triple BBB Physics) support using standard UNP-family physics bones. Maintained by ousnius as part of the BodySlide and Outfit Studio project.",
    gender: "female",
    family: "unp",
    topology: "unp",
    physicsSupport: true,
    skeletonProfile: "XPMSSE / XP32-compatible skeleton recommended",
    skeletonNotes:
      "UUNP Special physics deployments in Skyrim SE usually rely on XPMSSE-compatible bone layouts for breast/butt/belly runtime motion.",
    referenceProject: "UUNP by ousnius",
    aliases: [
      "UUNP",
      "Unified UNP",
      "Unified UNP Special",
      "UUNP SE",
      "UUNP Bodyslide",
      "UUNP Special",
    ],
    commonVariants: [
      "UUNP Special",
      "UUNP HDT",
      "UUNP Special HDT",
      "UUNP Special Physics",
      "UUNP Special TBBP",
      "UUNP BBP",
      "UUNP TBBP",
    ],
    physicsBones: [
      "NPC L Breast01",
      "NPC R Breast01",
      "NPC L Breast02",
      "NPC R Breast02",
      "NPC L Breast03",
      "NPC R Breast03",
      "NPC L Butt",
      "NPC R Butt",
      "NPC Belly",
    ],
    adaptationFocus: [
      "slider compatibility",
      "waist",
      "hip curve",
      "TBBP weighting",
    ],
    conversionNotes:
      "Shares topology with UNP but optimised for BodySlide workflows. Project onto the UUNP BodySlide reference body and rebuild OSP slider sets. UUNP Special ships with TBBP physics support — if the source mod includes physics configs, verify they match the UUNP bone naming (NPC L/R Breast01-03, L/R Butt, NPC Belly).",
  },
  "7base": {
    displayName: "7base – SevenBase Female Body",
    description:
      "Older stylised female body with an exaggerated silhouette: very large bust, narrow waist, and wide hips. Mainly found in legacy conversions from early Skyrim LE modding. Uses a non-standard topology that differs from both CBBE and UNP; closest to the UNP family for conversion purposes. Sub-variants include Bombshell (extreme bust), Natural, and Oppai.",
    gender: "female",
    family: "unp",
    topology: "legacy-female",
    physicsSupport: false,
    skeletonProfile: "Legacy UNP-family (XPMSSE recommended)",
    skeletonNotes:
      "Most Skyrim SE 7Base ports are paired with XPMSSE-compatible skeleton stacks even when the conversion itself is non-physics.",
    referenceProject: "SevenBase by Crosscrusade",
    aliases: [
      "7Base",
      "7B",
      "7BO",
      "SevenBase",
      "Seven Base",
      "7B Bombshell",
    ],
    commonVariants: [
      "7Base Bombshell",
      "7Base Natural",
      "7Base Oppai",
      "SevenBase Bombshell",
      "7B Natural",
      "7B Oppai",
      "7Base Curvy",
    ],
    physicsBones: [],
    adaptationFocus: [
      "stylised hips",
      "extreme bust",
      "thigh mass",
      "legacy seam cleanup",
    ],
    conversionNotes:
      "7Base topology differs from both CBBE and UNP because of significantly different and exaggerated body proportions. Treat seams at neck, wrist, and ankle as high-risk and validate with BodySlide preview plus in-game checks instead of relying on automatic seam stitching. 7Base Bombshell and Oppai are sub-variants with even larger bust proportions.",
  },
  sam: {
    displayName: "SAM – Shape Atlas for Men",
    description:
      "Advanced male body replacer with BodyMorph support for per-actor weight and muscle shape variation. SAM Light adds full BodySlide integration and is the recommended SE/AE-compatible version. SAM uses the XPMS Extended male skeleton. Created by VectorPlexus; SAM Light maintained by KouLeifoh.",
    gender: "male",
    family: "male",
    topology: "male",
    physicsSupport: false,
    skeletonProfile: "XPMSSE / SAM-compatible male skeleton required",
    skeletonNotes:
      "SAM and SAM Light typically expect XP32/XPMSSE-style male skeleton extensions and bodymorph-compatible setup in Skyrim SE. SAM Light is the version with active SE/AE support.",
    referenceProject: "SAM by VectorPlexus / SAM Light by KouLeifoh",
    aliases: [
      "SAM",
      "SAM Light",
      "SAM SE",
      "SAM SSE",
      "SAM AE",
      "Shape Atlas for Men",
      "Shape Atlas for Men Light",
      "SAM Morphs",
      "VectorPlexus SAM",
    ],
    commonVariants: [
      "SAM",
      "SAM Light",
      "SAM Light SE",
      "SAM Light SSE",
      "SAM Morphs",
      "SAM Light Body",
      "SAM High Poly Conversion",
    ],
    physicsBones: [],
    adaptationFocus: [
      "muscle sliders",
      "chest width",
      "waist taper",
      "thigh mass",
    ],
    conversionNotes:
      "Converting female armors to SAM requires full cross-gender mesh projection. Use SAM Light + BodySlide for slider-based output. After generating BodySlide output, register the outfit in SAMLightBodyConfig.json so SAM can apply per-actor morphs to it. Chest and waist proportions differ from HIMBO. SAM Light is the SE/AE-compatible version and should be preferred for new conversions.",
  },
  vanilla: {
    displayName: "Vanilla – Default Game Body",
    description:
      "The unmodified base game body mesh. Mods targeting vanilla will work without any body replacer installed.",
    gender: "both",
    family: "vanilla",
    topology: "vanilla",
    physicsSupport: false,
    skeletonProfile: "Vanilla Skyrim skeleton",
    skeletonNotes:
      "Vanilla targets should stay compatible with Bethesda's default skeleton paths; XPMSSE is optional unless physics-heavy body mods are mixed in.",
    referenceProject: "Bethesda Softworks",
    aliases: [
      "Vanilla",
      "Default Game Body",
      "Base Game Body",
      "Skyrim Vanilla",
    ],
    commonVariants: ["Vanilla Female", "Vanilla Male", "Bethesda Default"],
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
