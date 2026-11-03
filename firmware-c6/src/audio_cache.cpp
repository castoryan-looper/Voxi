#include "audio_cache.h"
#include "diagnostics.h"
#include <SPIFFS.h>
#include <LittleFS.h>
#include <esp_partition.h>
static fs::FS* cacheFs=nullptr;static File writing,reading;
static uint32_t cacheBytes=0;
static const char* path="/voxi-turn.pcm";
bool audioCacheInit(){
  if(SPIFFS.begin(false,"/spiffs",3,"storage"))cacheFs=&SPIFFS;
  else if(LittleFS.begin(false,"/littlefs",3,"storage"))cacheFs=&LittleFS;
  else{
    auto part=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_SPIFFS,"storage");
    if(!part){diagnosticError("Audio cache partition missing");return false;}
    uint8_t* block=(uint8_t*)malloc(4096);if(!block)return false;
    bool blank=true;
    for(size_t offset=0;offset<part->size&&blank;offset+=4096){
      size_t n=min((size_t)4096,(size_t)(part->size-offset));
      if(esp_partition_read(part,offset,block,n)!=ESP_OK){blank=false;break;}
      for(size_t i=0;i<n;i++)if(block[i]!=0xff){blank=false;break;}
      delay(1);
    }
    free(block);
    // Never format an unrecognised filesystem or any non-blank partition.
    if(blank&&SPIFFS.begin(true,"/spiffs",3,"storage"))cacheFs=&SPIFFS;
  }
  if(!cacheFs){diagnosticError("Audio cache unavailable; existing data left untouched");return false;}
  return true;
}
bool audioCacheStart(){
  audioCacheClose();if(!cacheFs)return false;
  writing=cacheFs->open(path,FILE_WRITE);cacheBytes=0;return (bool)writing;
}
bool audioCacheWrite(const uint8_t* data,size_t n){
  if(!writing||n%2||cacheBytes+n>30*48000)return false;
  if(writing.write(data,n)!=n)return false;cacheBytes+=n;return true;
}
bool audioCacheFinish(){if(!writing)return false;writing.flush();writing.close();return cacheBytes>0;}
bool audioCacheOpenUpload(){if(!cacheFs)return false;reading=cacheFs->open(path,FILE_READ);return reading&&reading.size()==cacheBytes;}
size_t audioCacheRead(uint8_t* data,size_t capacity){if(!reading)return 0;int n=reading.read(data,capacity);return n>0?(size_t)n:0;}
bool audioCacheEnd(){return reading&&reading.position()==cacheBytes;}
void audioCacheClose(){if(writing)writing.close();if(reading)reading.close();}
void audioCacheRemove(){audioCacheClose();if(cacheFs)cacheFs->remove(path);}
void audioCacheDiagnostics(JsonDocument& out){out["audioCacheReady"]=cacheFs!=nullptr;out["audioCacheBytes"]=cacheBytes;}
