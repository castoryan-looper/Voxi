#pragma once
// Hit regions shared with the 368x448 AMOLED control layout. Gaps do nothing.
enum class AmoledAction{None,Ptt,Previous,Setup,Next};
inline AmoledAction amoledTouchAction(bool down,int x,int y){
 if(!down)return AmoledAction::None;
 if(x>=16&&x<352&&y>=328&&y<396)return AmoledAction::Ptt;
 if(y>=404&&y<436){
  if(x>=16&&x<100)return AmoledAction::Previous;
  if(x>=112&&x<256)return AmoledAction::Setup;
  if(x>=268&&x<352)return AmoledAction::Next;
 }
 return AmoledAction::None;
}
