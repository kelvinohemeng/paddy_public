"use client";

import { useEffect, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

// Figma gallery (Property Details 171:2625): wide grey rounded frame
// with the "Page controls" pill (218:54732) at the bottom — a white
// pill of dots, the active one solid black. Swipe/drag, arrow keys and
// the hover arrows all move between photos; dots jump straight to one.
export function PhotoGallery({ urls, title }: { urls: string[]; title: string }) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  if (urls.length === 0) {
    return (
      <div className="text-muted-foreground flex aspect-[781/430] w-full items-center justify-center rounded-xl bg-[#f2f2f2] text-sm">
        No photos yet — this listing is still being prepared.
      </div>
    );
  }

  return (
    <Carousel
      setApi={setApi}
      opts={{ loop: urls.length > 1 }}
      className="group relative overflow-hidden rounded-xl bg-[#f2f2f2]"
    >
      <CarouselContent className="ml-0">
        {urls.map((url, i) => (
          <CarouselItem key={url + i} className="pl-0">
            <div className="aspect-[781/430] w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`${title} — photo ${i + 1} of ${urls.length}`}
                className="h-full w-full object-cover"
                loading={i === 0 ? "eager" : "lazy"}
              />
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>

      {urls.length > 1 && (
        <>
          <CarouselPrevious className="left-3 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100" />
          <CarouselNext className="right-3 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100" />
          <div className="absolute inset-x-0 bottom-7 flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1 shadow-[inset_999px_999px_0_rgba(0,0,0,0.08)]">
              {urls.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Show photo ${i + 1}`}
                  aria-current={i === current}
                  onClick={() => api?.scrollTo(i)}
                  className={cn(
                    "size-2 rounded-full transition-all duration-300",
                    i === current ? "w-4 bg-black" : "bg-black/40 hover:bg-black/60",
                  )}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Carousel>
  );
}
