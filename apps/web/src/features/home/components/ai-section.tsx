"use client";

import { cn } from "@quieter/ui/cn";
import type { ReactNode } from "react";

import { BranchArt } from "./branch-art";
import { Reveal, RevealChild } from "./reveal";

const CARD_CLASS =
  "relative size-full overflow-hidden rounded-[12px] border border-black/10 bg-bg-raised shadow-elevation-sm";

const Card = ({ children }: { children: ReactNode }) => (
  <div className={CARD_CLASS}>{children}</div>
);

const mails = [
  {
    address: "notifications@vercel.com",
    iconBox: "top-[24px] left-[25px] h-[33px] w-[38px]",
    iconSrc: "/landing/vercel-mark.svg",
    label: "Dev",
    labelClass: "bg-q-cyan/25 text-fg/75",
    pill: "top-[38px] left-[411px]",
    sender: "Vercel ",
    subject: "Failed preview deployment on team 'quieter'",
  },
  {
    address: "receipts@stripe.com",
    iconBox: "top-[24px] left-[25px] h-[33px] w-[38px]",
    iconSrc: "/landing/stripe-mark.svg",
    label: "Business",
    labelClass: "bg-q-orange/25 text-fg/75",
    pill: "top-[36px] left-[382px]",
    sender: "Stripe ",
    subject: "You got a new customer!",
  },
  {
    address: "leander@quieter.email",
    iconBox: "top-[21px] left-[23px] size-[40px] overflow-hidden rounded-[5px]",
    iconSrc: "/landing/avatar-leander.png",
    label: "Personal",
    labelClass: "bg-q-pink/25 text-fg/75",
    pill: "top-[36px] left-[384px]",
    sender: "Leander ",
    subject: "Photos from my Tokyo trip",
  },
] as const;

const LabellingCard = () => (
  <Card>
    <p className="absolute top-[65.5px] left-[73.5px] text-[20px] whitespace-nowrap text-fg">
      <span className="font-serif italic">AI</span>
      <span className="font-sans">{" labels any mail, based on "}</span>
      <span className="font-serif italic">your preferences</span>
    </p>

    <div className="absolute top-[147.5px] left-[39.5px] flex flex-col items-start gap-[10px] p-[10px]">
      {mails.map((mail, index) => (
        <RevealChild
          className="relative h-[81px] w-[486px] overflow-hidden rounded-[10px] bg-bg-surface"
          delay={0.1 + index * 0.08}
          key={mail.address}
        >
          <div className={cn("absolute", mail.iconBox)}>
            <img alt="" className="size-full object-cover" src={mail.iconSrc} />
          </div>

          <p className="absolute top-[19px] left-[90px] whitespace-nowrap text-fg">
            <span className="font-serif text-[16px] font-bold italic">
              {mail.sender}
            </span>
            <span className="font-sans text-[14px] font-light text-muted-fg italic">
              {mail.address}
            </span>
          </p>
          <p className="absolute top-[43px] left-[90px] font-sans text-[14px] font-light whitespace-nowrap text-fg italic">
            {mail.subject}
          </p>

          <div
            className={cn(
              "absolute flex items-center justify-center overflow-hidden rounded-[6px] px-[18px] py-[6px]",
              mail.labelClass,
              mail.pill
            )}
          >
            <p className="font-sans text-[12px] whitespace-nowrap">
              {mail.label}
            </p>
          </div>
        </RevealChild>
      ))}
    </div>
  </Card>
);

const VoiceCard = () => (
  <Card>
    <p className="absolute top-[386.5px] left-[88px] whitespace-nowrap text-fg">
      <span className="font-sans text-[20px]">{"Write mails that "}</span>
      <span className="font-serif text-[20px] italic">sound like you</span>
      <span className="font-sans text-[20px]"> </span>
      <span className="font-sans text-[12px]">and not some clanker</span>
    </p>

    <RevealChild
      className="absolute top-[65.5px] left-[59px] flex w-[469px] flex-col items-center justify-center gap-[10px] rounded-[15px] bg-bg-surface px-[15px] py-[10px] text-fg italic"
      delay={0.1}
    >
      <div className="flex w-full items-center gap-[10px] overflow-hidden px-[15px] py-[10px]">
        <p className="shrink-0 font-serif text-[14px] italic">To:</p>
        <p className="shrink-0 font-serif text-[12px] font-bold italic">
          support@openai.com
        </p>
      </div>
      <div className="flex w-full items-center gap-[10px] overflow-hidden px-[15px] py-[10px]">
        <p className="shrink-0 font-serif text-[14px] italic">Subject:</p>
        <p className="shrink-0 font-serif text-[12px] font-bold italic">
          Please give me more tokens.
        </p>
      </div>
    </RevealChild>

    <RevealChild
      className="absolute top-[184.5px] left-[59px] h-[149px] w-[469px] overflow-hidden rounded-[15px] bg-bg-surface"
      delay={0.2}
    >
      <p className="absolute top-[27px] left-[25px] font-sans text-[10px] whitespace-pre text-fg">
        {"Hi Tibothy!\n\nIn our last conversation we"}
      </p>
      <div className="home-writing-gradient absolute top-[51px] left-[154px] h-[14px] w-[192px] rounded-[5px]" />
      <div className="absolute top-[51px] left-[25px] h-[14px] w-[127px] bg-gradient-to-r from-transparent to-bg-surface" />
    </RevealChild>
  </Card>
);

const DarkButton = ({
  children,
  struck = false,
}: {
  children: ReactNode;
  struck?: boolean;
}) => (
  <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-fg px-[16px] py-[5px]">
    <p
      className={cn("font-sans text-[12px] whitespace-nowrap text-bg-surface", {
        "line-through": struck,
      })}
    >
      {children}
    </p>
  </div>
);

const TiltedArrow = () => (
  <div className="flex size-[16.895px] shrink-0 items-center justify-center">
    <div className="flex-none rotate-[-2.73deg]">
      <img alt="" className="size-[16.143px]" src="/landing/arrow-right.svg" />
    </div>
  </div>
);

const BriefCard = () => (
  <Card>
    <BranchArt
      className="top-[2px] left-[-0.5px] h-[377px] w-[302px]"
      side="left"
    />
    <BranchArt
      className="top-[63px] left-[262.5px] h-[404px] w-[323px]"
      side="right"
    />

    <p className="absolute top-[383px] left-[106.5px] text-[20px] whitespace-nowrap text-fg">
      <span className="font-sans">{"Your "}</span>
      <span className="font-serif italic">daily brief</span>
      <span className="font-sans">{" of the "}</span>
      <span className="font-serif italic">important stuff</span>
    </p>

    <RevealChild
      className="absolute top-[41px] left-[71.5px] flex h-[98.981px] w-[433.255px] items-center justify-center"
      delay={0.12}
    >
      <div className="flex-none rotate-[1.59deg]">
        <div className="flex flex-col items-center justify-center gap-[10px] overflow-hidden rounded-[8px] bg-bg-surface p-[16px]">
          <div className="flex items-center gap-[10px] overflow-hidden px-[10px]">
            <p className="shrink-0 font-serif text-[14px] whitespace-nowrap text-fg italic">
              YCombinator rejected your application
            </p>
            <TiltedArrow />
          </div>
          <div className="flex items-center gap-[10px] overflow-hidden px-[8px]">
            <DarkButton>Remind me to apply next year again</DarkButton>
            <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-black/20 px-[16px] py-[5px]">
              <p className="font-sans text-[12px] whitespace-nowrap text-fg">
                Draft a rage tweet
              </p>
            </div>
          </div>
        </div>
      </div>
    </RevealChild>

    <RevealChild
      className="absolute top-[167px] left-[95.5px] flex h-[41.397px] w-[457.413px] items-center justify-center"
      delay={0.2}
    >
      <div className="flex-none rotate-[-0.43deg]">
        <div className="flex items-center justify-center gap-[10px] overflow-hidden rounded-[8px] bg-bg-surface px-[16px] py-[10px]">
          <p className="shrink-0 font-serif text-[14px] whitespace-nowrap text-fg italic">
            Tibothy from OpenAI told you to never message him ever again
          </p>
          <img
            alt=""
            className="size-[16.143px] shrink-0"
            src="/landing/arrow-right.svg"
          />
        </div>
      </div>
    </RevealChild>

    <RevealChild
      className="absolute top-[237px] left-[53.5px] flex h-[100.53px] w-[428.718px] items-center justify-center"
      delay={0.28}
    >
      <div className="flex-none rotate-[2.09deg]">
        <div className="flex flex-col items-center justify-center gap-[10px] overflow-hidden rounded-[8px] bg-bg-surface p-[16px]">
          <div className="flex items-center gap-[10px] overflow-hidden px-[10px]">
            <p className="shrink-0 font-serif text-[14px] whitespace-nowrap text-fg italic">
              Your mom asks when you will finally earn some money
            </p>
            <TiltedArrow />
          </div>
          <div className="flex items-center overflow-hidden px-[8px]">
            <DarkButton struck>Tell her the truth</DarkButton>
          </div>
        </div>
      </div>
    </RevealChild>
  </Card>
);

const ChatCard = () => (
  <Card>
    <p className="absolute top-[49px] left-[186px] text-[20px] whitespace-nowrap text-fg">
      <span className="font-serif italic">{"Chat "}</span>
      <span className="font-sans">with your mailbox</span>
    </p>

    <RevealChild
      className="absolute top-[136.5px] left-[287.5px] flex items-center justify-center overflow-hidden rounded-tl-[35px] rounded-tr-[10px] rounded-br-[35px] rounded-bl-[35px] bg-bg-surface px-[30px] py-[20px]"
      delay={0.12}
    >
      <p className="shrink-0 text-center font-serif text-[16px] whitespace-nowrap text-fg italic">
        Beg Tibothy for more tokens
      </p>
    </RevealChild>

    <RevealChild
      className="absolute top-[206.5px] left-[50.5px] flex items-center justify-center overflow-hidden rounded-tl-[10px] rounded-tr-[35px] rounded-br-[35px] rounded-bl-[10px] border border-black/10 bg-bg-raised px-[30px] py-[20px] shadow-elevation-sm"
      delay={0.22}
    >
      <p className="shrink-0 text-center font-serif text-[16px] whitespace-nowrap text-fg italic">
        Getting desperate huh?
      </p>
    </RevealChild>

    <RevealChild
      className="absolute top-[280.5px] left-[50.5px] flex h-[141px] flex-col items-start justify-center gap-[20px] overflow-hidden rounded-tl-[10px] rounded-tr-[35px] rounded-br-[35px] rounded-bl-[35px] border border-black/10 bg-bg-raised px-[30px] py-[20px] shadow-elevation-sm"
      delay={0.32}
    >
      <p className="shrink-0 text-center font-serif text-[16px] whitespace-nowrap text-fg italic">
        Drafted another mail for you:
      </p>
      <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-tl-[6px] rounded-tr-[25px] rounded-br-[25px] rounded-bl-[25px] bg-bg-surface px-[30px] py-[20px]">
        <p className="shrink-0 text-center font-serif text-[16px] whitespace-nowrap text-fg italic">
          TIBO PLEASEEEEEEEEEE
        </p>
      </div>
    </RevealChild>
  </Card>
);

export const AiSection = () => (
  <>
    <Reveal className="flex flex-col items-center justify-center overflow-hidden p-[40px]">
      <div className="text-center font-serif text-fg italic">
        <h2 className="text-[48px] whitespace-pre">
          AI that does the annoying things
        </h2>
        <p className="mt-[20px] text-[20px] whitespace-pre">
          completely optional.
        </p>
      </div>
    </Reveal>

    <div className="grid h-[1188px] w-[1435px] grid-cols-2 grid-rows-2 gap-[50px] p-[100px]">
      <Reveal className="col-start-1 row-start-1">
        <LabellingCard />
      </Reveal>
      <Reveal className="col-start-2 row-start-1" delay={0.08}>
        <VoiceCard />
      </Reveal>
      <Reveal className="col-start-1 row-start-2" delay={0.16}>
        <BriefCard />
      </Reveal>
      <Reveal className="col-start-2 row-start-2" delay={0.24}>
        <ChatCard />
      </Reveal>
    </div>
  </>
);
