export interface ICard {
  value: string;
  faceUp: boolean;
  isBusy: boolean;
  setIsBusy(isBusy: boolean): Promise<Card>;
  getIsBusy(): Promise<boolean>;
  setFaceUp(faceUp: boolean): Promise<Card>;
  getValue(): string | undefined;
  setValue(value: string): Promise<Card>;
  getFaceUp(): Promise<boolean>;
}

export class Card implements ICard {
  public value: string;
  public faceUp: boolean;
  public isBusy: boolean;
  public constructor(value: string, faceUp: boolean, isBusy: boolean) {
    this.value = value;
    this.faceUp = faceUp;
    this.isBusy = isBusy;
  }

  public async setFaceUp(faceUp: boolean): Promise<Card> {
    this.faceUp = faceUp;
    return this;
  }
  public async setValue(value: string): Promise<Card> {
    this.value = value;
    return this;
  }
  public getValue(): string | undefined {
    if (this.faceUp) {
      return this.value;
    }
    return undefined;
  }
  public async getFaceUp(): Promise<boolean> {
    return this.faceUp;
  }
  public async getIsBusy(): Promise<boolean> {
    return this.isBusy;
  }
  public async setIsBusy(isBusy: boolean): Promise<Card> {
    this.isBusy = isBusy;
    return this;
  }
}