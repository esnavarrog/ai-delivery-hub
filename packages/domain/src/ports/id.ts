export interface IdGenerator {
  /** RFC 4122 UUID string, matching `z.uuid()`. */
  uuid(): string;
}
