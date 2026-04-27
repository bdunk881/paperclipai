declare module "passport-google-oauth20" {
  export class Strategy {
    constructor(options: any, verify: (...args: any[]) => void);
  }
}

declare module "passport-facebook" {
  export class Strategy {
    constructor(options: any, verify: (...args: any[]) => void);
  }
}

declare module "@nicokaiser/passport-apple" {
  export default class Strategy {
    constructor(options: any, verify: (...args: any[]) => void);
  }
}
