/**
 * Ambient module declarations for passkit-node-sdk.
 *
 * passkit-node-sdk is a pure-JS package (proto-generated, no TypeScript source).
 * There are no @types/passkit-node-sdk types on DefinitelyTyped and the package
 * itself ships no .d.ts files. We declare each sub-path we import as `any` to
 * satisfy strict noImplicitAny. The real types are enforced at the call-site via
 * the promisify<TReq, TRes> helper in programs.ts.
 *
 * TODO(plan-4): If passkit-grpc-typescript-sdk becomes available and stable,
 * migrate to that package which ships proper TypeScript declarations.
 */

declare module "passkit-node-sdk/io/member/a_rpc_grpc_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const MembersClient: any;
}

declare module "passkit-node-sdk/io/core/a_rpc_templates_grpc_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const TemplatesClient: any;
}

declare module "passkit-node-sdk/io/core/a_rpc_images_grpc_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const ImagesClient: any;
}

declare module "passkit-node-sdk/io/common/template_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const DefaultTemplateRequest: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PassTemplate: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Colors: any;
}

declare module "passkit-node-sdk/io/common/protocols_pb" {
  export const PassProtocol: {
    PASS_PROTOCOL_DO_NOT_USE: 0;
    RAW_PROTOCOL: 1;
    V1_PROTOCOL: 2;
    FLIGHT_PROTOCOL: 3;
    MEMBERSHIP: 100;
    SINGLE_USE_COUPON: 101;
    EVENT_TICKETING: 102;
  };
}

declare module "passkit-node-sdk/io/member/program_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Program: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const PointsType: any;
  export const BalanceType: {
    BALANCE_TYPE_STRING: 0;
    BALANCE_TYPE_INT: 1;
    BALANCE_TYPE_DOUBLE: 2;
    BALANCE_TYPE_MONEY: 3;
  };
}

declare module "passkit-node-sdk/io/member/tier_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Tier: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const TierRequestInput: any;
}

declare module "passkit-node-sdk/io/common/project_pb" {
  export const ProjectStatus: {
    NO_PROJECT_STATUS: 0;
    PROJECT_ACTIVE_FOR_OBJECT_CREATION: 1;
    PROJECT_DISABLED_FOR_OBJECT_CREATION: 2;
    PROJECT_DRAFT: 4;
    PROJECT_PUBLISHED: 8;
    PROJECT_PRIVATE: 16;
    PROJECT_OVER_QUOTA: 32;
    PROJECT_DELETED: 64;
    PROJECT_EMAIL_WARNING: 128;
    PROJECT_EMAIL_SUSPENDED: 256;
  };
}

declare module "passkit-node-sdk/io/common/common_objects_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Id: any;
}

declare module "passkit-node-sdk/io/member/member_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Member: any;
}

declare module "passkit-node-sdk/io/common/personal_pb" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Person: any;
}
